import { ENTE_CLIENT_PACKAGE, DEFAULT_ENTE_API } from "./types";
import type {
  AuthenticatorEntityDiffResponse,
  AuthenticatorEntityKey,
  EmailVerificationResponse,
  EntityCreateResponse,
  SRPAttributes,
  TwoFactorAuthorizationResponse,
} from "./types";

export class EnteApiError extends Error {
  constructor(
    public status: number,
    public body: string,
  ) {
    super(`Ente API ${status}: ${body.slice(0, 200)}`);
    this.name = "EnteApiError";
  }
}

export function normalizeServerUrl(url?: string): string {
  if (!url || !url.trim()) return DEFAULT_ENTE_API;
  return url.trim().replace(/\/+$/, "");
}

const publicHeaders: HeadersInit = {
  "Content-Type": "application/json",
  "X-Client-Package": ENTE_CLIENT_PACKAGE,
};

function authHeaders(token: string, extra?: HeadersInit): HeadersInit {
  return {
    ...(extra || {}),
    "X-Auth-Token": token,
    "X-Client-Package": ENTE_CLIENT_PACKAGE,
  };
}

async function readError(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

export async function getSRPAttributes(
  apiUrl: string,
  email: string,
): Promise<SRPAttributes | undefined> {
  const url = new URL("/users/srp/attributes", apiUrl);
  url.searchParams.set("email", email);
  const res = await fetch(url.toString(), { headers: publicHeaders });
  if (res.status === 404) return undefined;
  if (!res.ok) throw new EnteApiError(res.status, await readError(res));
  const data = (await res.json()) as { attributes: SRPAttributes };
  return data.attributes;
}

export async function requestEmailOTT(apiUrl: string, email: string): Promise<void> {
  const res = await fetch(`${apiUrl}/users/ott`, {
    method: "POST",
    headers: publicHeaders,
    body: JSON.stringify({ email, purpose: "login" }),
  });
  if (!res.ok) throw new EnteApiError(res.status, await readError(res));
}

export async function verifyEmail(
  apiUrl: string,
  email: string,
  ott: string,
): Promise<EmailVerificationResponse> {
  const res = await fetch(`${apiUrl}/users/verify-email`, {
    method: "POST",
    headers: publicHeaders,
    body: JSON.stringify({ email, ott }),
  });
  if (!res.ok) throw new EnteApiError(res.status, await readError(res));
  return (await res.json()) as EmailVerificationResponse;
}

export async function verifyTwoFactor(
  apiUrl: string,
  sessionID: string,
  code: string,
): Promise<TwoFactorAuthorizationResponse> {
  const res = await fetch(`${apiUrl}/users/two-factor/verify`, {
    method: "POST",
    headers: publicHeaders,
    body: JSON.stringify({ code, sessionID }),
  });
  if (!res.ok) throw new EnteApiError(res.status, await readError(res));
  return (await res.json()) as TwoFactorAuthorizationResponse;
}

export async function getAuthenticatorEntityKey(
  apiUrl: string,
  token: string,
): Promise<AuthenticatorEntityKey | undefined> {
  const res = await fetch(`${apiUrl}/authenticator/key`, {
    headers: authHeaders(token),
  });
  if (res.status === 404) return undefined;
  if (!res.ok) throw new EnteApiError(res.status, await readError(res));
  return (await res.json()) as AuthenticatorEntityKey;
}

export async function createAuthenticatorEntityKey(
  apiUrl: string,
  token: string,
  body: { encryptedKey: string; header: string },
): Promise<void> {
  const res = await fetch(`${apiUrl}/authenticator/key`, {
    method: "POST",
    headers: authHeaders(token, { "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new EnteApiError(res.status, await readError(res));
}

export async function getEntityDiff(
  apiUrl: string,
  token: string,
  sinceTime: number,
  limit: number,
): Promise<AuthenticatorEntityDiffResponse> {
  const url = new URL("/authenticator/entity/diff", apiUrl);
  url.searchParams.set("sinceTime", String(sinceTime));
  url.searchParams.set("limit", String(limit));
  const res = await fetch(url.toString(), { headers: authHeaders(token) });
  if (!res.ok) throw new EnteApiError(res.status, await readError(res));
  return (await res.json()) as AuthenticatorEntityDiffResponse;
}

export async function createEntity(
  apiUrl: string,
  token: string,
  body: { encryptedData: string; header: string },
): Promise<EntityCreateResponse> {
  const res = await fetch(`${apiUrl}/authenticator/entity`, {
    method: "POST",
    headers: authHeaders(token, { "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new EnteApiError(res.status, await readError(res));
  return (await res.json()) as EntityCreateResponse;
}

export async function updateEntity(
  apiUrl: string,
  token: string,
  body: { id: string; encryptedData: string; header: string },
): Promise<void> {
  const res = await fetch(`${apiUrl}/authenticator/entity`, {
    method: "PUT",
    headers: authHeaders(token, { "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new EnteApiError(res.status, await readError(res));
}

export async function deleteEntity(
  apiUrl: string,
  token: string,
  id: string,
): Promise<void> {
  const url = new URL("/authenticator/entity", apiUrl);
  url.searchParams.set("id", id);
  const res = await fetch(url.toString(), {
    method: "DELETE",
    headers: authHeaders(token),
  });
  // 404 means already gone — treat as success.
  if (res.status === 404) return;
  if (!res.ok) throw new EnteApiError(res.status, await readError(res));
}
