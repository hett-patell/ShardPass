import { canonicalJson } from "@shardpass/storage";

import { createEnteClient } from "./client";
import type { EnteCycleCrypto } from "./operational-cycle";
import { encryptEnteOtpEntity, parseEnteOtpEntity } from "./otp-adapter";
import { EnteProtocolError, type EnteOtpProjection } from "./protocol";
import type { EnteRuntimeDependencies } from "./runtime";
import { createEnteSodiumAdapter } from "./sodium-adapter";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const base64 = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};
const unbase64 = (value: string) => {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};
const digest = async (value: Uint8Array) => {
  const owned = Uint8Array.from(value);
  try {
    return base64(new Uint8Array(await crypto.subtle.digest("SHA-256", owned.buffer)));
  } finally {
    owned.fill(0);
  }
};

export function createProductionEnteRuntimeDependencies(): EnteRuntimeDependencies {
  let sodium: Awaited<ReturnType<typeof createEnteSodiumAdapter>> | undefined;
  const sodiumReady = createEnteSodiumAdapter().then((adapter) => {
    sodium = adapter;
    return adapter;
  });
  const client = createEnteClient({ fetch: (url, init) => fetch(url, init) });
  const cryptoAdapter: EnteCycleCrypto = {
    openCredential(envelope) {
      const bytes = unbase64(envelope);
      try {
        return Promise.resolve(decoder.decode(bytes));
      } finally {
        bytes.fill(0);
      }
    },
    openAuthKey(envelope) {
      const authKey = unbase64(envelope);
      if (authKey.byteLength !== 32) {
        authKey.fill(0);
        throw new EnteProtocolError("ENTE_INVALID");
      }
      return Promise.resolve(authKey);
    },
    openProjection(envelope) {
      const bytes = unbase64(envelope);
      try {
        return Promise.resolve(JSON.parse(decoder.decode(bytes)) as EnteOtpProjection);
      } catch {
        throw new EnteProtocolError("ENTE_INVALID");
      } finally {
        bytes.fill(0);
      }
    },
    sealProjection(projection) {
      const bytes = encoder.encode(canonicalJson(projection));
      try {
        return Promise.resolve(base64(bytes));
      } finally {
        bytes.fill(0);
      }
    },
    async digestProjection(projection) {
      const bytes = encoder.encode(canonicalJson(projection));
      try {
        return await digest(bytes);
      } finally {
        bytes.fill(0);
      }
    },
    decryptEntity(entity, authKey) {
      if (entity.isDeleted || sodium === undefined) throw new EnteProtocolError("ENTE_UNAVAILABLE");
      return parseEnteOtpEntity(
        { version: 1, encryptedData: entity.encryptedData, header: entity.header },
        authKey,
        sodium,
      );
    },
    encryptEntity(projection, authKey) {
      if (sodium === undefined) throw new EnteProtocolError("ENTE_UNAVAILABLE");
      return encryptEnteOtpEntity(projection, authKey, sodium);
    },
  };
  return Object.freeze({
    client,
    crypto: cryptoAdapter,
    now: () => Date.now(),
    nextId: () => crypto.randomUUID(),
    rootDigest: async (sessionEpoch: number) =>
      digest(encoder.encode(`shardpass:ente:root:${sessionEpoch}`)),
    sodiumReady,
    randomCapability: () => {
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      try {
        return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
      } finally {
        bytes.fill(0);
      }
    },
  });
}
