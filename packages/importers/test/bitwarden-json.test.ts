import { describe, expect, it } from "vitest";

import { importBitwardenJson } from "../src";

function fixture(overrides: Record<string, unknown> = {}) {
  return {
    encrypted: false,
    folders: [],
    items: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        type: 1,
        name: "GitHub",
        notes: "personal account",
        favorite: true,
        login: {
          username: "user@example.com",
          password: "hunter2",
          uris: [{ match: null, uri: "https://github.com" }],
        },
      },
      {
        id: "22222222-2222-4222-8222-222222222222",
        type: 2,
        name: "Recovery codes",
        notes: "1234-5678\n8765-4321",
        favorite: false,
        secureNote: { type: 0 },
      },
      {
        id: "33333333-3333-4333-8333-333333333333",
        type: 3,
        name: "Personal Visa",
        notes: "",
        favorite: false,
        card: {
          cardholderName: "John Doe",
          brand: "Visa",
          number: "4111111111111111",
          expMonth: "12",
          expYear: "2030",
          code: "123",
        },
      },
      {
        id: "44444444-4444-4444-8444-444444444444",
        type: 4,
        name: "Home identity",
        notes: "",
        favorite: false,
        identity: {
          firstName: "John",
          lastName: "Doe",
          address1: "123 Main St",
          address2: "Apt 4",
          city: "Springfield",
          state: "IL",
          postalCode: "62701",
          country: "US",
          email: "john@example.com",
          phone: "555-1234",
        },
      },
    ],
    ...overrides,
  };
}

describe("importBitwardenJson", () => {
  it("imports login, note, card, and identity items", () => {
    const result = importBitwardenJson(JSON.stringify(fixture()));
    expect(result.warnings).toHaveLength(0);
    expect(result.items).toHaveLength(4);

    const [login, note, card, identity] = result.items;

    expect(login!.kind).toBe("login");
    if (login!.kind !== "login") throw new Error("expected login");
    expect(login!.name).toBe("GitHub");
    expect(login!.username).toBe("user@example.com");
    expect(login!.password).toBe("hunter2");
    expect(login!.urls).toEqual(["https://github.com"]);
    expect(login!.favorite).toBe(true);

    expect(note!.kind).toBe("note");
    if (note!.kind !== "note") throw new Error("expected note");
    expect(note!.name).toBe("Recovery codes");
    expect(note!.content).toBe("1234-5678\n8765-4321");

    expect(card!.kind).toBe("card");
    if (card!.kind !== "card") throw new Error("expected card");
    expect(card!.cardholderName).toBe("John Doe");
    expect(card!.number).toBe("4111111111111111");
    expect(card!.expMonth).toBe("12");
    expect(card!.expYear).toBe("2030");
    expect(card!.cvv).toBe("123");

    expect(identity!.kind).toBe("identity");
    if (identity!.kind !== "identity") throw new Error("expected identity");
    expect(identity!.firstName).toBe("John");
    expect(identity!.lastName).toBe("Doe");
    // address2 is its own field now rather than folded into street.
    expect(identity!.street).toBe("123 Main St");
    expect(identity!.address2).toBe("Apt 4");
    expect(identity!.city).toBe("Springfield");
    expect(identity!.email).toBe("john@example.com");
  });

  it("returns a warning instead of throwing for invalid JSON", () => {
    const result = importBitwardenJson("not json");
    expect(result.items).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
  });

  it("returns a warning instead of throwing when the items array is missing", () => {
    const result = importBitwardenJson(JSON.stringify({ encrypted: false }));
    expect(result.items).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
  });

  it("skips unsupported item types with a warning", () => {
    const result = importBitwardenJson(
      JSON.stringify(
        fixture({
          items: [{ id: "1", type: 99, name: "Unknown", notes: "" }],
        }),
      ),
    );
    expect(result.items).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("Unknown");
  });

  it("skips non-object entries with a warning", () => {
    const result = importBitwardenJson(JSON.stringify({ items: ["not an object"] }));
    expect(result.items).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
  });
});

describe("importBitwardenJson extras", () => {
  it("turns folders (with slash paths) into provisional folders and files items into them", () => {
    const result = importBitwardenJson(
      JSON.stringify({
        encrypted: false,
        folders: [
          { id: "f-work", name: "Work/Clients" },
          { id: "f-home", name: "Home" },
        ],
        items: [
          {
            id: "i1",
            type: 1,
            name: "Client portal",
            folderId: "f-work",
            login: { username: "a", password: "b", uris: [] },
          },
          {
            id: "i2",
            type: 2,
            name: "Wifi",
            folderId: "f-home",
            notes: "pass",
            secureNote: { type: 0 },
          },
          {
            id: "i3",
            type: 1,
            name: "Loose",
            folderId: null,
            login: { username: "c", password: "d", uris: [] },
          },
        ],
      }),
    );
    expect(result.warnings).toHaveLength(0);
    const folders = result.folders ?? [];
    expect(folders.map((folder) => folder.name).sort()).toEqual(["Clients", "Home", "Work"]);
    const work = folders.find((folder) => folder.name === "Work")!;
    const clients = folders.find((folder) => folder.name === "Clients")!;
    expect(clients.parentId).toBe(work.id);
    expect(work.parentId).toBeUndefined();
    expect(result.items[0]?.folderId).toBe(clients.id);
    expect(result.items[1]?.folderId).toBe(folders.find((folder) => folder.name === "Home")?.id);
    expect(result.items[2]?.folderId).toBeUndefined();
  });

  it("keeps password history newest first and the item's own timestamps", () => {
    const result = importBitwardenJson(
      JSON.stringify({
        items: [
          {
            type: 1,
            name: "Mail",
            creationDate: "2024-01-02T03:04:05.000Z",
            revisionDate: "2025-06-07T08:09:10.000Z",
            passwordHistory: [
              { lastUsedDate: "2024-05-01T00:00:00.000Z", password: "older" },
              { lastUsedDate: "2025-01-01T00:00:00.000Z", password: "newer" },
            ],
            login: { username: "u", password: "current", uris: [] },
          },
        ],
      }),
    );
    const item = result.items[0];
    if (item?.kind !== "login") throw new Error("expected login");
    expect(item.createdAt).toBe("2024-01-02T03:04:05.000Z");
    expect(item.updatedAt).toBe("2025-06-07T08:09:10.000Z");
    expect(item.passwordHistory?.map((entry) => entry.password)).toEqual(["newer", "older"]);
  });

  it("names a password-protected export instead of calling it malformed", () => {
    const result = importBitwardenJson(JSON.stringify({ encrypted: true, data: "..." }));
    expect(result.items).toHaveLength(0);
    expect(result.warnings[0]).toContain("password-protected");
  });

  it("files an organisation item under its collection when it has no folder", () => {
    const result = importBitwardenJson(
      JSON.stringify({
        encrypted: false,
        collections: [
          { id: "c-eng", organizationId: "org", name: "Engineering/Infra" },
          { id: "c-ops", organizationId: "org", name: "Ops" },
        ],
        folders: [{ id: "f-mine", name: "Mine" }],
        items: [
          {
            id: "i1",
            type: 1,
            name: "Router",
            folderId: null,
            collectionIds: ["c-eng"],
            login: { username: "a", password: "b", uris: [] },
          },
          {
            id: "i2",
            type: 1,
            name: "Pager",
            folderId: "f-mine",
            collectionIds: ["c-ops"],
            login: { username: "c", password: "d", uris: [] },
          },
          {
            id: "i3",
            type: 1,
            name: "Loose",
            folderId: null,
            collectionIds: [],
            login: { username: "e", password: "f", uris: [] },
          },
        ],
      }),
    );
    expect(result.warnings).toHaveLength(0);
    const folders = result.folders ?? [];
    expect(folders.map((folder) => folder.name).sort()).toEqual([
      "Engineering",
      "Infra",
      "Mine",
      "Ops",
    ]);
    const infra = folders.find((folder) => folder.name === "Infra")!;
    expect(infra.parentId).toBe(folders.find((folder) => folder.name === "Engineering")?.id);
    expect(result.items[0]?.folderId).toBe(infra.id);
    // A personal folder wins over the collection when both are set.
    expect(result.items[1]?.folderId).toBe(folders.find((folder) => folder.name === "Mine")?.id);
    expect(result.items[2]?.folderId).toBeUndefined();
  });

  it("says when a login's passkeys are left behind", () => {
    const result = importBitwardenJson(
      JSON.stringify({
        items: [
          {
            type: 1,
            name: "Passkey site",
            login: {
              username: "u",
              password: "p",
              uris: [],
              fido2Credentials: [{ credentialId: "x", rpId: "site.test" }],
            },
          },
        ],
      }),
    );
    expect(result.items).toHaveLength(1);
    expect(result.warnings).toEqual(['"Passkey site": passkey not imported.']);
  });

  it("keeps a readable totp (URI, bare secret or steam://) and drops an unreadable one with a warning", () => {
    const result = importBitwardenJson(
      JSON.stringify({
        items: [
          {
            type: 1,
            name: "URI",
            login: {
              username: "u",
              password: "p",
              uris: [],
              totp: "otpauth://totp/URI:u?secret=JBSWY3DPEHPK3PXP&issuer=URI",
            },
          },
          {
            type: 1,
            name: "Bare",
            login: { username: "u", password: "p", uris: [], totp: "jbsw y3dp ehpk 3pxp" },
          },
          {
            type: 1,
            name: "Steam",
            login: { username: "u", password: "p", uris: [], totp: "steam://JBSWY3DPEHPK3PXP" },
          },
          {
            type: 1,
            name: "Junk",
            login: { username: "u", password: "p", uris: [], totp: "not-a-valid-secret-1" },
          },
        ],
      }),
    );
    const totps = result.items.map((item) => (item.kind === "login" ? item.totp : "?"));
    expect(totps).toEqual([
      "otpauth://totp/URI:u?secret=JBSWY3DPEHPK3PXP&issuer=URI",
      "JBSWY3DPEHPK3PXP",
      "steam://JBSWY3DPEHPK3PXP",
      undefined,
    ]);
    expect(result.warnings).toEqual([
      '"Junk": the one-time-code secret could not be read and was left out.',
    ]);
  });

  it("bounds custom fields and URLs to the schema, naming what was dropped", () => {
    const fields = Array.from({ length: 40 }, (_, index) => ({
      name: `f${index}`,
      type: 0,
      value: "v",
    }));
    const uris = Array.from({ length: 20 }, (_, index) => ({
      uri: `https://s${index}.example`,
      match: 3,
    }));
    const result = importBitwardenJson(
      JSON.stringify({
        items: [{ type: 1, name: "Big", login: { username: "u", password: "p", uris }, fields }],
      }),
    );
    const item = result.items[0];
    if (item?.kind !== "login") throw new Error("expected login");
    expect(item.customFields).toHaveLength(32);
    expect(item.urls).toHaveLength(16);
    expect(item.urlMatches).toHaveLength(16);
    expect(result.warnings).toEqual([
      '"Big": only the first 16 URLs were kept.',
      '"Big": only the first 32 custom fields were kept.',
    ]);
  });

  it("names the failing field instead of calling the whole item invalid", () => {
    const result = importBitwardenJson(
      JSON.stringify({
        items: [{ type: 3, name: "Card", card: { number: "4111", expMonth: "123" } }],
      }),
    );
    expect(result.items).toHaveLength(0);
    expect(result.warnings).toEqual([
      'Skipped "Card": invalid card item (expMonth did not pass validation).',
    ]);
  });
});

describe("importBitwardenJson SSH keys", () => {
  it("imports a type-5 item as an SSH key secret with its public key and fingerprint", () => {
    const result = importBitwardenJson(
      JSON.stringify({
        encrypted: false,
        folders: [],
        items: [
          {
            id: "1",
            type: 5,
            name: "Deploy key",
            notes: "for CI",
            favorite: false,
            sshKey: {
              privateKey:
                "-----BEGIN OPENSSH PRIVATE KEY-----\nAAAA\n-----END OPENSSH PRIVATE KEY-----\n",
              publicKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDummy",
              keyFingerprint: "SHA256:abc",
            },
          },
        ],
      }),
    );
    expect(result.warnings).toEqual([]);
    expect(result.items[0]).toMatchObject({
      kind: "secret",
      secretType: "ssh_key",
      name: "Deploy key",
      value: "-----BEGIN OPENSSH PRIVATE KEY-----\nAAAA\n-----END OPENSSH PRIVATE KEY-----\n",
      metadata: {
        publicKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDummy",
        fingerprint: "SHA256:abc",
        keyType: "ssh-ed25519",
      },
      notes: "for CI",
    });
  });
});
