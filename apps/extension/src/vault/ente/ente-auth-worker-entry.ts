/// <reference lib="webworker" />

import "../../background/ente/srp-compat/install-buffer-global";

import { createEnteClient } from "../../background/ente/client";
import {
  createEnteSodiumAdapter,
  type EnteSodiumAdapter,
} from "../../background/ente/sodium-adapter";
import { encodeEnteSessionPayload } from "../../background/ente/session-handoff";
import { createEnteSrpClient } from "../../background/ente/srp-adapter";
import { installEnteAuthWorker } from "./ente-auth-worker";
import type { EnteAuthWorkerResponse } from "./ente-auth-worker-protocol";

const scope = self as DedicatedWorkerGlobalScope;
const decoder = new TextDecoder("utf-8", { fatal: true });
const encoder = new TextEncoder();
const base64Url = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
};
const randomCapability = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  try {
    return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  } finally {
    bytes.fill(0);
  }
};
type Continuation = {
  sessionId: string;
  kek: Uint8Array;
  handoffCapability: string;
  handoffPublicKey: Uint8Array;
};
const continuations = new Map<string, Continuation>();

function recoverSession(
  response: {
    token?: string;
    encryptedToken?: string;
    keyAttributes?: unknown;
  },
  kek: Uint8Array,
  sodium: EnteSodiumAdapter,
): { token: string; masterKey: Uint8Array } {
  const attributes = response.keyAttributes as
    | {
        encryptedKey?: string;
        keyDecryptionNonce?: string;
        encryptedSecretKey?: string;
        secretKeyDecryptionNonce?: string;
        publicKey?: string;
      }
    | undefined;
  if (attributes?.encryptedKey === undefined || attributes.keyDecryptionNonce === undefined)
    throw new Error();
  const masterKey = sodium.secretboxOpen(
    sodium.fromBase64(attributes.encryptedKey),
    sodium.fromBase64(attributes.keyDecryptionNonce),
    kek,
  );
  if (response.token !== undefined) return { token: response.token, masterKey };
  if (
    response.encryptedToken === undefined ||
    attributes.encryptedSecretKey === undefined ||
    attributes.secretKeyDecryptionNonce === undefined ||
    attributes.publicKey === undefined
  ) {
    masterKey.fill(0);
    throw new Error();
  }
  const secretKey = sodium.secretboxOpen(
    sodium.fromBase64(attributes.encryptedSecretKey),
    sodium.fromBase64(attributes.secretKeyDecryptionNonce),
    masterKey,
  );
  try {
    const token = sodium.sealedBoxOpen(
      sodium.fromBase64(response.encryptedToken),
      sodium.fromBase64(attributes.publicKey),
      secretKey,
    );
    try {
      return { token: base64Url(token), masterKey };
    } finally {
      token.fill(0);
    }
  } finally {
    secretKey.fill(0);
  }
}

async function completeResult(
  jobId: string,
  capability: string,
  publicKey: Uint8Array,
  token: string,
  masterKey: Uint8Array,
  client: ReturnType<typeof createEnteClient>,
  sodium: EnteSodiumAdapter,
) {
  let authKey: Uint8Array | undefined;
  let fingerprint: Uint8Array | undefined;
  let payload: Uint8Array | undefined;
  const tokenUtf8 = encoder.encode(token);
  try {
    const response = (await client.getAuthenticatorKey(token, new AbortController().signal)) as {
      encryptedKey?: unknown;
      header?: unknown;
    };
    if (typeof response.encryptedKey !== "string" || typeof response.header !== "string")
      throw new Error();
    const encryptedAuthKey = sodium.fromBase64(response.encryptedKey);
    const authHeader = sodium.fromBase64(response.header);
    try {
      authKey = sodium.secretboxOpen(encryptedAuthKey, authHeader, masterKey);
    } finally {
      encryptedAuthKey.fill(0);
      authHeader.fill(0);
    }
    fingerprint = new Uint8Array(
      await crypto.subtle.digest("SHA-256", Uint8Array.from(authKey).buffer),
    );
    payload = encodeEnteSessionPayload({
      token: tokenUtf8,
      masterKey,
      authKey,
      accountFingerprint: fingerprint,
    });
    return {
      version: 1,
      kind: "ente.auth.complete",
      jobId,
      capability,
      ciphertext: Uint8Array.from(sodium.sealedBoxSeal(payload, publicKey)),
    } as const;
  } finally {
    tokenUtf8.fill(0);
    masterKey.fill(0);
    authKey?.fill(0);
    fingerprint?.fill(0);
    payload?.fill(0);
  }
}

installEnteAuthWorker(
  scope,
  async (request): Promise<Exclude<EnteAuthWorkerResponse, { kind: "ente.auth.error" }>> => {
    const sodium = await createEnteSodiumAdapter();
    const client = createEnteClient({ fetch: (url, init) => fetch(url, init) });
    try {
      if (request.kind === "ente.auth.totp") {
        const continuation = continuations.get(request.capability);
        continuations.delete(request.capability);
        if (continuation === undefined) throw new Error();
        try {
          const response = (await client.verifyTotp2fa(
            { code: decoder.decode(request.codeUtf8), sessionID: continuation.sessionId },
            new AbortController().signal,
          )) as { encryptedToken?: string; token?: string; keyAttributes?: unknown };
          const recovered = recoverSession(response, continuation.kek, sodium);
          return await completeResult(
            request.jobId,
            continuation.handoffCapability,
            continuation.handoffPublicKey,
            recovered.token,
            recovered.masterKey,
            client,
            sodium,
          );
        } finally {
          continuation.kek.fill(0);
          continuation.handoffPublicKey.fill(0);
        }
      }

      const email = decoder.decode(request.emailUtf8);
      const password = Uint8Array.from(request.passwordUtf8);
      let kek: Uint8Array | undefined;
      try {
        const attributesResponse = (await client.getSrpAttributes(
          email,
          new AbortController().signal,
        )) as {
          attributes: {
            srpUserID: string;
            srpSalt: string;
            kekSalt: string;
            opsLimit: number;
            memLimit: number;
          };
        };
        const attributes = attributesResponse.attributes;
        kek = sodium.argon2id(
          password,
          sodium.fromBase64(attributes.kekSalt),
          attributes.opsLimit,
          attributes.memLimit,
          32,
        );
        const loginKey = sodium.deriveSubkey(kek, 16, 1, "loginctx");
        const identity = encoder.encode(attributes.srpUserID);
        const srp = createEnteSrpClient({
          usernameUtf8: identity,
          passwordKey: loginKey,
          salt: sodium.fromBase64(attributes.srpSalt),
        });
        try {
          const session = (await client.createSrpSession(
            { srpUserID: attributes.srpUserID, srpA: sodium.toBase64(srp.clientPublicA()) },
            new AbortController().signal,
          )) as { sessionID: string; srpB: string };
          const proof = srp.clientProof(sodium.fromBase64(session.srpB));
          const verified = (await client.verifySrpSession(
            {
              sessionID: session.sessionID,
              srpUserID: attributes.srpUserID,
              srpM1: sodium.toBase64(proof.M1),
            },
            new AbortController().signal,
          )) as {
            srpM2: string;
            token?: string;
            encryptedToken?: string;
            twoFactorSessionID?: string;
            keyAttributes?: unknown;
          };
          srp.verifyServerProof(sodium.fromBase64(verified.srpM2));
          proof.sessionKey.fill(0);
          if (verified.twoFactorSessionID !== undefined) {
            const capability = randomCapability();
            continuations.set(capability, {
              sessionId: verified.twoFactorSessionID,
              kek,
              handoffCapability: request.handoffCapability,
              handoffPublicKey: Uint8Array.from(request.handoffPublicKey),
            });
            kek = undefined;
            return {
              version: 1,
              kind: "ente.auth.totp-required",
              jobId: request.jobId,
              capability,
            };
          }
          const recovered = recoverSession(verified, kek, sodium);
          return await completeResult(
            request.jobId,
            request.handoffCapability,
            request.handoffPublicKey,
            recovered.token,
            recovered.masterKey,
            client,
            sodium,
          );
        } finally {
          identity.fill(0);
          loginKey.fill(0);
          srp.dispose();
        }
      } finally {
        password.fill(0);
        kek?.fill(0);
      }
    } finally {
      sodium.dispose();
    }
  },
);
