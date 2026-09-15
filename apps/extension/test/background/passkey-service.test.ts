import type { VaultItem } from "@shardpass/domain";
import type { SenderContext } from "@shardpass/messaging";
import { fromBase64Url, sha256 } from "@shardpass/passkeys";
import { describe, expect, it } from "vitest";

import { PasskeyService } from "../../src/background/passkey/passkey-service";

const contentSender: SenderContext = {
  extensionId: "extension-id",
  contextKind: "content",
  senderUrl: "https://github.com/login",
  tabId: 7,
  frameId: 0,
  documentId: "content-document",
};
const stamp = "2026-08-10T12:00:00.000Z";
const LOGIN_ID = "11111111-1111-4111-8111-111111111111";

function login(overrides: Record<string, unknown> = {}): VaultItem {
  return {
    id: LOGIN_ID,
    kind: "login",
    schemaVersion: 2,
    revision: 1,
    createdAt: stamp,
    updatedAt: stamp,
    favorite: false,
    tags: [],
    name: "GitHub",
    username: "octocat",
    password: "pw",
    urls: ["https://github.com"],
    notes: "",
    ...overrides,
  };
}

function fixture(items: VaultItem[] = []) {
  const store = new Map(items.map((item) => [item.id, item]));
  const repository = {
    listAllItems: () => Promise.resolve([...store.values()]),
    getItem: (id: string) => Promise.resolve(store.get(id) ?? null),
    createItem: (candidate: VaultItem) => {
      store.set(candidate.id, candidate);
      return Promise.resolve(candidate);
    },
    updateItem: (candidate: VaultItem, expectedRevision: number) => {
      const current = store.get(candidate.id);
      if (current === undefined || current.revision !== expectedRevision)
        return Promise.reject(new Error("conflict"));
      const next = { ...candidate, revision: expectedRevision + 1 } as VaultItem;
      store.set(candidate.id, next);
      return Promise.resolve(next);
    },
  };
  const service = new PasskeyService({
    repository,
    now: () => 1_755_000_000_000,
    notePrivilegedActivity: () => Promise.resolve(),
  });
  return { service, store };
}
const req = (kind: string, values: Record<string, unknown>) =>
  ({ version: 1, kind, ...values }) as never;
const clientData = (type: string) =>
  new TextEncoder().encode(
    JSON.stringify({
      type,
      challenge: "Y2hhbGxlbmdl",
      origin: "https://github.com",
      crossOrigin: false,
    }),
  );
const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");

describe("PasskeyService", () => {
  it("registers a passkey on the matching login and later signs an assertion the relying party can verify", async () => {
    const { service, store } = fixture([login()]);
    const registered = (await service.handle(
      req("passkey.register", {
        origin: "https://github.com",
        rpId: "github.com",
        rpName: "GitHub",
        userHandle: "dXNlcg",
        userName: "octocat",
        userDisplayName: "Octo Cat",
        algorithms: [-8, -7, -257],
        excludeCredentialIds: [],
        clientDataJson: b64url(clientData("webauthn.create")),
      }),
      contentSender,
    )) as {
      itemId: string;
      credentialId: string;
      publicKey: string;
      authenticatorData: string;
      attestationObject: string;
    };
    expect(registered.itemId).toBe(LOGIN_ID);
    const saved = store.get(LOGIN_ID) as {
      passkeys?: { rpId: string; userName: string; credentialId: string }[];
      revision: number;
    };
    expect(saved.passkeys).toHaveLength(1);
    expect(saved.passkeys?.[0]).toMatchObject({
      rpId: "github.com",
      userName: "octocat",
      credentialId: registered.credentialId,
    });
    expect(saved.revision).toBe(2);
    expect(fromBase64Url(registered.attestationObject)[0]).toBe(0xa3);

    const candidates = (await service.handle(
      req("passkey.candidates", {
        origin: "https://github.com",
        rpId: "github.com",
        allowCredentialIds: [],
      }),
      contentSender,
    )) as { candidates: { itemId: string; credentialId: string; userName: string }[] };
    expect(candidates.candidates).toEqual([
      {
        itemId: LOGIN_ID,
        credentialId: registered.credentialId,
        userName: "octocat",
        loginName: "GitHub",
      },
    ]);

    const client = clientData("webauthn.get");
    const asserted = (await service.handle(
      req("passkey.assert", {
        origin: "https://github.com",
        rpId: "github.com",
        itemId: LOGIN_ID,
        credentialId: registered.credentialId,
        clientDataJson: b64url(client),
      }),
      contentSender,
    )) as { authenticatorData: string; signature: string; userHandle: string };
    expect(asserted.userHandle).toBe("dXNlcg");
    const authData = fromBase64Url(asserted.authenticatorData);
    expect(authData.byteLength).toBe(37);
    expect(authData[32]).toBe(0x1d);

    const publicKey = await crypto.subtle.importKey(
      "spki",
      Uint8Array.from(fromBase64Url(registered.publicKey)).buffer,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    const der = fromBase64Url(asserted.signature);
    const raw = derToRaw(der);
    const message = Uint8Array.from([...authData, ...(await sha256(client))]).buffer;
    expect(
      await crypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        publicKey,
        Uint8Array.from(raw).buffer,
        message,
      ),
    ).toBe(true);
  });

  it("creates a login when the site has none, refuses foreign rp ids, and honours exclude lists", async () => {
    const { service, store } = fixture([]);
    const registered = (await service.handle(
      req("passkey.register", {
        origin: "https://accounts.example.test",
        rpId: "example.test",
        rpName: "Example",
        userHandle: "aWQ",
        userName: "me@example.test",
        userDisplayName: "",
        algorithms: [-7],
        excludeCredentialIds: [],
        clientDataJson: b64url(clientData("webauthn.create")),
      }),
      { ...contentSender, senderUrl: "https://accounts.example.test/login" },
    )) as { itemId: string; credentialId: string };
    const created = store.get(registered.itemId) as {
      username: string;
      urls: string[];
      passkeys: unknown[];
    };
    expect(created).toMatchObject({ username: "me@example.test", urls: ["https://example.test"] });
    expect(created.passkeys).toHaveLength(1);

    await expect(
      service.handle(
        req("passkey.register", {
          origin: "https://evil.test",
          rpId: "example.test",
          rpName: "x",
          userHandle: "aWQ",
          userName: "u",
          userDisplayName: "",
          algorithms: [-7],
          excludeCredentialIds: [],
          clientDataJson: b64url(clientData("webauthn.create")),
        }),
        contentSender,
      ),
    ).rejects.toMatchObject({ code: "PASSKEY_INVALID" });

    await expect(
      service.handle(
        req("passkey.register", {
          origin: "https://example.test",
          rpId: "example.test",
          rpName: "x",
          userHandle: "aWQ",
          userName: "me@example.test",
          userDisplayName: "",
          algorithms: [-7],
          excludeCredentialIds: [registered.credentialId],
          clientDataJson: b64url(clientData("webauthn.create")),
        }),
        { ...contentSender, senderUrl: "https://example.test/login" },
      ),
    ).rejects.toMatchObject({ code: "PASSKEY_EXISTS" });

    await expect(
      service.handle(
        req("passkey.register", {
          origin: "https://example.test",
          rpId: "example.test",
          rpName: "x",
          userHandle: "aWQ",
          userName: "other",
          userDisplayName: "",
          algorithms: [-257],
          excludeCredentialIds: [],
          clientDataJson: b64url(clientData("webauthn.create")),
        }),
        { ...contentSender, senderUrl: "https://example.test/login" },
      ),
    ).rejects.toMatchObject({ code: "PASSKEY_UNSUPPORTED" });
  });
});

function derToRaw(der: Uint8Array): Uint8Array {
  const raw = new Uint8Array(64);
  let offset = 2;
  for (const half of [0, 32]) {
    offset += 1;
    const length = der[offset]!;
    offset += 1;
    const value = der.subarray(offset, offset + length);
    const trimmed = value.byteLength > 32 ? value.subarray(value.byteLength - 32) : value;
    raw.set(trimmed, half + 32 - trimmed.byteLength);
    offset += length;
  }
  return raw;
}
