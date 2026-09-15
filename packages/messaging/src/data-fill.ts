import { z } from "zod/mini";

import type { CommandSenderPolicy } from "./context";
import { MESSAGE_VERSION } from "./envelope";

const version = z.literal(MESSAGE_VERSION);
const itemId = z.uuid();
const text = (max: number) => z.string().check(z.maxLength(max));

/**
 * Filling a card or an identity into a page. Unlike a login, neither is tied to a site, so
 * a page can never ask for one on its own: the popup grants one release for one item to
 * one tab (a deliberate act), and only that tab's content script may then collect it, once.
 */
export const DataFillRequestSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    version,
    kind: z.literal("data.fillGrant"),
    itemId,
    tabId: z.int().check(z.nonnegative()),
  }),
  z.strictObject({ version, kind: z.literal("data.fillSelect"), itemId }),
]);

export const DataFillGrantedResponseSchema = z.strictObject({
  version,
  kind: z.literal("data.fillGranted"),
  itemId,
  expiresAt: z.int().check(z.nonnegative()),
});

export const CardFillValuesSchema = z.strictObject({
  number: text(32),
  cardholderName: text(256),
  expMonth: text(2),
  expYear: text(4),
  cvv: text(8),
});

export const IdentityFillValuesSchema = z.strictObject({
  firstName: text(256),
  middleName: z.optional(text(256)),
  lastName: text(256),
  email: text(256),
  phone: text(64),
  company: z.optional(text(256)),
  username: z.optional(text(256)),
  street: text(512),
  address2: z.optional(text(512)),
  city: text(256),
  state: text(256),
  zip: text(32),
  country: text(256),
  birthDate: z.optional(text(32)),
});

export const DataFillReleaseResponseSchema = z.discriminatedUnion("data", [
  z.strictObject({
    version,
    kind: z.literal("data.fillRelease"),
    data: z.literal("card"),
    card: CardFillValuesSchema,
  }),
  z.strictObject({
    version,
    kind: z.literal("data.fillRelease"),
    data: z.literal("identity"),
    identity: IdentityFillValuesSchema,
  }),
]);

export const DataFillResponseSchema = z.union([
  DataFillGrantedResponseSchema,
  DataFillReleaseResponseSchema,
]);

export type DataFillRequest = z.infer<typeof DataFillRequestSchema>;
export type DataFillResponse = z.infer<typeof DataFillResponseSchema>;
export type DataFillCommandKind = DataFillRequest["kind"];

const popupAndVault = { allowedContexts: ["popup", "vault"], requireDocument: true } as const;
const contentOnly = {
  allowedContexts: ["content"],
  requireTab: true,
  requireFrame: true,
  requireDocument: true,
} as const;

export const dataFillSenderPolicy = {
  "data.fillGrant": popupAndVault,
  "data.fillSelect": contentOnly,
} satisfies Record<DataFillCommandKind, CommandSenderPolicy>;

export function parseDataFillResponseForRequest(
  request: DataFillRequest,
  candidate: unknown,
): Readonly<{ success: true; data: DataFillResponse }> | Readonly<{ success: false }> {
  const parsed = DataFillResponseSchema.safeParse(candidate);
  if (!parsed.success) return { success: false };
  const expected = request.kind === "data.fillGrant" ? "data.fillGranted" : "data.fillRelease";
  if (parsed.data.kind !== expected) return { success: false };
  return { success: true, data: parsed.data };
}
