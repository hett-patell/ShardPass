import {
  authenticatorEntityDiffResponseSchema,
  authenticatorKeyResponseSchema,
  createEntityRequestSchema,
  createEntityResponseSchema,
  createSrpSessionRequestSchema,
  createSrpSessionResponseSchema,
  deleteEntityQuerySchema,
  srpAttributesResponseSchema,
  totpTwoFactorVerifyRequestSchema,
  totpTwoFactorVerifyResponseSchema,
  updateEntityRequestSchema,
  verifySrpSessionRequestSchema,
  verifySrpSessionResponseSchema,
} from "./schemas";
import {
  ENTE_API_ORIGIN,
  ENTE_SYNC_LIMITS,
  EnteProtocolError,
  parseEnteProtocolResponse,
} from "./protocol";

/** Identifies this client to Ente; the value the official auth web client sends. */
export const ENTE_CLIENT_PACKAGE = "io.ente.auth.web";

export type EnteFetch = (url: string, init: RequestInit) => Promise<Response>;
export interface EnteResponseBudget {
  readonly limitBytes: number;
  readonly usedBytes: number;
  charge(bytes: number): void;
  assertAvailable(declaredBytes: number): void;
}
export function createEnteResponseBudget(
  limitBytes = ENTE_SYNC_LIMITS.maxCycleResponseBytes,
): EnteResponseBudget {
  if (!Number.isSafeInteger(limitBytes) || limitBytes < 0) throw fixedError("ENTE_INVALID");
  let usedBytes = 0;
  const assertAvailable = (bytes: number) => {
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > limitBytes - usedBytes)
      throw fixedError("ENTE_LIMIT_REACHED");
  };
  return Object.freeze({
    limitBytes,
    get usedBytes() {
      return usedBytes;
    },
    assertAvailable,
    charge(bytes: number) {
      assertAvailable(bytes);
      usedBytes += bytes;
    },
  });
}

export interface EnteClient {
  getSrpAttributes(
    email: string,
    signal: AbortSignal,
    budget?: EnteResponseBudget,
  ): Promise<unknown>;
  createSrpSession(
    body: unknown,
    signal: AbortSignal,
    budget?: EnteResponseBudget,
  ): Promise<unknown>;
  verifySrpSession(
    body: unknown,
    signal: AbortSignal,
    budget?: EnteResponseBudget,
  ): Promise<unknown>;
  verifyTotp2fa(body: unknown, signal: AbortSignal, budget?: EnteResponseBudget): Promise<unknown>;
  getAuthenticatorKey(
    token: string,
    signal: AbortSignal,
    budget?: EnteResponseBudget,
  ): Promise<unknown>;
  getEntityDiff(
    token: string,
    sinceTime: number,
    signal: AbortSignal,
    budget?: EnteResponseBudget,
  ): Promise<ReturnType<typeof authenticatorEntityDiffResponseSchema.parse>>;
  createEntity(
    token: string,
    body: unknown,
    signal: AbortSignal,
    budget?: EnteResponseBudget,
  ): Promise<unknown>;
  updateEntity(
    token: string,
    body: unknown,
    signal: AbortSignal,
    budget?: EnteResponseBudget,
  ): Promise<void>;
  deleteEntity(
    token: string,
    id: string,
    signal: AbortSignal,
    budget?: EnteResponseBudget,
  ): Promise<void>;
}

const encoder = new TextEncoder();
const fixedError = (code: ConstructorParameters<typeof EnteProtocolError>[0]) => {
  const error = new EnteProtocolError(code);
  error.message = "Ente request failed";
  return error;
};
function validEmail(email: string): void {
  if (
    encoder.encode(email).byteLength < 3 ||
    encoder.encode(email).byteLength > ENTE_SYNC_LIMITS.maxEmailUtf8Bytes ||
    !email.includes("@")
  )
    throw fixedError("ENTE_INVALID");
}
function validToken(token: string): void {
  if (!token || token.length > ENTE_SYNC_LIMITS.maxBase64TextBytes || /[\r\n]/u.test(token))
    throw fixedError("ENTE_INVALID");
}
function combineSignal(parent: AbortSignal): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const abort = () => controller.abort();
  parent.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, ENTE_SYNC_LIMITS.requestTimeoutMs);
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      parent.removeEventListener("abort", abort);
    },
  };
}
function validateResponseBounds(response: Response, budget: EnteResponseBudget): void {
  let headerBytes = 0;
  response.headers.forEach((value, key) => {
    headerBytes += encoder.encode(key).byteLength + encoder.encode(value).byteLength;
  });
  if (headerBytes > ENTE_SYNC_LIMITS.maxHeaderBytes) throw fixedError("ENTE_LIMIT_REACHED");
  const declared = response.headers.get("content-length");
  if (declared === null) return;
  if (!/^\d+$/u.test(declared)) throw fixedError("ENTE_LIMIT_REACHED");
  const declaredBytes = Number(declared);
  if (declaredBytes > ENTE_SYNC_LIMITS.maxResponseBytes) throw fixedError("ENTE_LIMIT_REACHED");
  budget.assertAvailable(declaredBytes);
}
async function boundedBytes(response: Response, budget: EnteResponseBudget): Promise<Uint8Array> {
  validateResponseBounds(response, budget);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > ENTE_SYNC_LIMITS.maxResponseBytes) throw fixedError("ENTE_LIMIT_REACHED");
  budget.charge(bytes.byteLength);
  return bytes;
}
async function boundedJson(response: Response, budget: EnteResponseBudget): Promise<unknown> {
  const bytes = await boundedBytes(response, budget);
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw fixedError("ENTE_PROTOCOL_DRIFT");
  } finally {
    bytes.fill(0);
  }
}

export function createEnteClient(dependencies: { readonly fetch: EnteFetch }): EnteClient {
  const request = async <T>(input: {
    method: "GET" | "POST" | "PUT" | "DELETE";
    path: string;
    token?: string;
    body?: unknown;
    signal: AbortSignal;
    schema?: { parse(value: unknown): T };
    empty?: boolean;
    budget?: EnteResponseBudget;
  }): Promise<T> => {
    if (!input.path.startsWith("/")) throw fixedError("ENTE_INVALID");
    if (input.token !== undefined) validToken(input.token);
    input.budget?.assertAvailable(1);
    const linked = combineSignal(input.signal);
    // Ente's server keys behaviour on the client package (which app, which token form);
    // this is the value the official auth web client sends.
    const headers: Record<string, string> = {
      Accept: "application/json",
      "X-Client-Package": ENTE_CLIENT_PACKAGE,
    };
    if (input.body !== undefined) headers["Content-Type"] = "application/json";
    if (input.token !== undefined) headers["X-Auth-Token"] = input.token;
    try {
      const response = await dependencies.fetch(`${ENTE_API_ORIGIN}${input.path}`, {
        method: input.method,
        headers,
        ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
        signal: linked.signal,
        redirect: "error",
        credentials: "omit",
        cache: "no-store",
        referrerPolicy: "no-referrer",
      });
      if (response.status === 401) throw fixedError("ENTE_REAUTH_REQUIRED");
      if (response.status === 404 && input.method === "GET" && input.path === "/authenticator/key")
        throw fixedError("ENTE_AUTH_KEY_MISSING");
      if (response.status < 200 || response.status >= 300)
        throw fixedError(response.status >= 500 ? "ENTE_UNAVAILABLE" : "ENTE_AUTH_FAILED");
      if (input.empty) {
        if (response.status !== 200 && response.status !== 204)
          throw fixedError("ENTE_PROTOCOL_DRIFT");
        const bytes = await boundedBytes(response, input.budget ?? createEnteResponseBudget());
        try {
          if (bytes.byteLength !== 0) throw fixedError("ENTE_PROTOCOL_DRIFT");
        } finally {
          bytes.fill(0);
        }
        return undefined as T;
      }
      const json = await boundedJson(response, input.budget ?? createEnteResponseBudget());
      return input.schema === undefined
        ? (json as T)
        : parseEnteProtocolResponse(input.schema as never, json);
    } catch (error) {
      if (error instanceof EnteProtocolError) throw error;
      throw fixedError("ENTE_UNAVAILABLE");
    } finally {
      linked.dispose();
    }
  };
  return {
    getSrpAttributes(email, signal, budget) {
      validEmail(email);
      return request({
        method: "GET",
        path: `/users/srp/attributes?email=${encodeURIComponent(email)}`,
        signal,
        ...(budget === undefined ? {} : { budget }),
        schema: srpAttributesResponseSchema,
      });
    },
    createSrpSession(body, signal, budget) {
      const parsed = createSrpSessionRequestSchema.parse(body);
      return request({
        method: "POST",
        path: "/users/srp/create-session",
        body: parsed,
        signal,
        ...(budget === undefined ? {} : { budget }),
        schema: createSrpSessionResponseSchema,
      });
    },
    verifySrpSession(body, signal, budget) {
      const parsed = verifySrpSessionRequestSchema.parse(body);
      return request({
        method: "POST",
        path: "/users/srp/verify-session",
        body: parsed,
        signal,
        ...(budget === undefined ? {} : { budget }),
        schema: verifySrpSessionResponseSchema,
      });
    },
    verifyTotp2fa(body, signal, budget) {
      const parsed = totpTwoFactorVerifyRequestSchema.parse(body);
      return request({
        method: "POST",
        path: "/users/two-factor/verify",
        body: parsed,
        signal,
        ...(budget === undefined ? {} : { budget }),
        schema: totpTwoFactorVerifyResponseSchema,
      });
    },
    getAuthenticatorKey(token, signal, budget) {
      return request({
        method: "GET",
        path: "/authenticator/key",
        token,
        signal,
        ...(budget === undefined ? {} : { budget }),
        schema: authenticatorKeyResponseSchema,
      });
    },
    getEntityDiff(token, sinceTime, signal, budget) {
      if (!Number.isSafeInteger(sinceTime) || sinceTime < 0) throw fixedError("ENTE_INVALID");
      return request({
        method: "GET",
        path: `/authenticator/entity/diff?sinceTime=${sinceTime}&limit=${ENTE_SYNC_LIMITS.pageSize}`,
        token,
        signal,
        ...(budget === undefined ? {} : { budget }),
        schema: authenticatorEntityDiffResponseSchema,
      });
    },
    createEntity(token, body, signal, budget) {
      const parsed = createEntityRequestSchema.parse(body);
      return request({
        method: "POST",
        path: "/authenticator/entity",
        token,
        body: parsed,
        signal,
        ...(budget === undefined ? {} : { budget }),
        schema: createEntityResponseSchema,
      });
    },
    async updateEntity(token, body, signal, budget) {
      const parsed = updateEntityRequestSchema.parse(body);
      await request({
        method: "PUT",
        path: "/authenticator/entity",
        token,
        body: parsed,
        signal,
        ...(budget === undefined ? {} : { budget }),
        empty: true,
      });
    },
    async deleteEntity(token, id, signal, budget) {
      const parsed = deleteEntityQuerySchema.parse({ id });
      await request({
        method: "DELETE",
        path: `/authenticator/entity?id=${parsed.id}`,
        token,
        signal,
        ...(budget === undefined ? {} : { budget }),
        empty: true,
      });
    },
  };

}
