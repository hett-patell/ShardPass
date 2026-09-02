import { isUnicodeScalarText } from "@shardpass/domain";
import { Tokenizer, TokenParser, TokenType } from "@streamparser/json";

import { IMPORT_LIMITS, type ImportReasonCode } from "./import-model";

export type JsonFailureCode = Extract<
  ImportReasonCode,
  "IMPORT_MALFORMED" | "IMPORT_UNSUPPORTED" | "IMPORT_LIMIT_EXCEEDED"
>;

export class JsonImportError extends Error {
  readonly code: JsonFailureCode;

  constructor(code: JsonFailureCode) {
    super(code);
    this.name = "JsonImportError";
    this.code = code;
  }
}

export const failJson = (code: JsonFailureCode): never => {
  throw new JsonImportError(code);
};

const MAX_JSON_DEPTH = 64;
const MAX_JSON_CONTAINER_ITEMS = IMPORT_LIMITS.maxEntries;
const MAX_JSON_OBJECT_KEYS = 256;
export const MAX_JSON_STRING_SCALARS = 4_096;
const MAX_JSON_ICON_ENCODED_LENGTH = Math.ceil(IMPORT_LIMITS.maxInputBytes / 3) * 4;
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

type JsonToken = Readonly<{
  token: TokenType;
  value: string | number | boolean | null;
  partial?: boolean;
}>;
type Container =
  | {
      readonly kind: "object";
      readonly keys: Set<string>;
      expectingKey: boolean;
      pendingKey?: string;
    }
  | { readonly kind: "array"; items: number };

export function measureImportText(text: string): void {
  if (!isUnicodeScalarText(text)) failJson("IMPORT_MALFORMED");
  let bytes = 0;
  let scalars = 0;
  for (const character of text) {
    scalars += 1;
    const point = character.codePointAt(0)!;
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
    if (bytes > IMPORT_LIMITS.maxInputBytes || scalars > IMPORT_LIMITS.maxTextScalars)
      failJson("IMPORT_LIMIT_EXCEEDED");
  }
}

const INVALID_JSON_NUMBER = Object.freeze({ invalidJsonNumber: true });

class LosslessIntegerTokenizer extends Tokenizer {
  protected override parseNumber(numberText: string): number {
    if (!/^(?:0|[1-9]\d*)$/u.test(numberText) || numberText.length > 16)
      return INVALID_JSON_NUMBER as unknown as number;
    const integer = BigInt(numberText);
    if (integer > BigInt(Number.MAX_SAFE_INTEGER)) return INVALID_JSON_NUMBER as unknown as number;
    return Number(integer);
  }
}

function inspectToken(token: JsonToken, stack: Container[]): void {
  const parent = stack.at(-1);
  if (
    parent?.kind === "array" &&
    token.token !== TokenType.RIGHT_BRACKET &&
    token.token !== TokenType.COMMA
  ) {
    parent.items += 1;
    if (parent.items > MAX_JSON_CONTAINER_ITEMS) failJson("IMPORT_LIMIT_EXCEEDED");
  }

  if (token.token === TokenType.LEFT_BRACE || token.token === TokenType.LEFT_BRACKET) {
    stack.push(
      token.token === TokenType.LEFT_BRACE
        ? { kind: "object", keys: new Set(), expectingKey: true }
        : { kind: "array", items: 0 },
    );
    if (stack.length > MAX_JSON_DEPTH) failJson("IMPORT_LIMIT_EXCEEDED");
    return;
  }
  if (token.token === TokenType.RIGHT_BRACE || token.token === TokenType.RIGHT_BRACKET) {
    stack.pop();
    return;
  }
  if (token.token === TokenType.COMMA) {
    const current = stack.at(-1);
    if (current?.kind === "object") {
      current.expectingKey = true;
      delete current.pendingKey;
    }
    return;
  }
  if (token.token === TokenType.COLON) return;

  const current = stack.at(-1);
  if (token.token === TokenType.STRING) {
    const value = token.value as string;
    const isKey = current?.kind === "object" && current.expectingKey;
    const maximum =
      current?.kind === "object" && !isKey && current.pendingKey === "icon"
        ? MAX_JSON_ICON_ENCODED_LENGTH
        : MAX_JSON_STRING_SCALARS;
    if ([...value].length > maximum) failJson("IMPORT_LIMIT_EXCEEDED");
    if (value.includes("\0") || !isUnicodeScalarText(value)) failJson("IMPORT_MALFORMED");
    if (isKey) {
      if (DANGEROUS_KEYS.has(value) || current.keys.has(value)) failJson("IMPORT_MALFORMED");
      current.keys.add(value);
      if (current.keys.size > MAX_JSON_OBJECT_KEYS) failJson("IMPORT_LIMIT_EXCEEDED");
      current.pendingKey = value;
      current.expectingKey = false;
    }
  }
}

export function parseBoundedJson(text: string): unknown {
  measureImportText(text);
  const stack: Container[] = [];
  let root: unknown;
  let hasRoot = false;
  try {
    const tokenizer = new LosslessIntegerTokenizer({
      stringBufferSize: 64 * 1_024,
      numberBufferSize: 64,
    });
    const parser = new TokenParser();
    tokenizer.onToken = (token) => {
      inspectToken(token, stack);
      parser.write(token);
    };
    tokenizer.onEnd = () => {
      if (!parser.isEnded) parser.end();
    };
    parser.onError = (error) => tokenizer.error(error);
    parser.onValue = ({ value, stack: valueStack }) => {
      if (valueStack.length === 0) {
        root = value;
        hasRoot = true;
      }
    };
    parser.onEnd = () => {
      if (!tokenizer.isEnded) tokenizer.end();
    };
    tokenizer.write(text);
    if (!tokenizer.isEnded) tokenizer.end();
  } catch (error) {
    if (error instanceof JsonImportError) throw error;
    failJson("IMPORT_MALFORMED");
  }
  if (!hasRoot) failJson("IMPORT_MALFORMED");
  const pending: unknown[] = [root];
  while (pending.length > 0) {
    const value: unknown = pending.pop();
    if (typeof value === "number" && !Number.isSafeInteger(value)) failJson("IMPORT_UNSUPPORTED");
    if (Array.isArray(value)) {
      const values: unknown[] = value;
      pending.push(...values);
    } else if (isPlainRecord(value)) pending.push(...Object.values(value));
  }
  return root;
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
