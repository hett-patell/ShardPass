import { describe, expect, it } from "vitest";

import {
  encodeLoginsCsvExport,
  encodePlaintextJsonExport,
  LOGINS_CSV_COLUMNS,
  PLAINTEXT_EXPORT_TYPE,
  PLAINTEXT_EXPORT_WARNING,
  type PortableBackupPayload,
  type PortableBackupPayloadV2,
} from "../src/backup";

const decoder = new TextDecoder();
const metadata = {
  schemaVersion: 2 as const,
  revision: 1,
  createdAt: "2026-03-04T05:06:07.000Z",
  updatedAt: "2026-03-04T05:06:07.000Z",
  favorite: false,
  tags: [],
};
const otpId = "11111111-1111-4111-8111-111111111111";
const hotpId = "22222222-2222-4222-8222-222222222222";
const folderId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const payload: PortableBackupPayloadV2 = {
  schemaVersion: 2,
  exportedAt: "2026-08-12T12:34:56.789Z",
  items: [
    {
      ...metadata,
      id: otpId,
      kind: "otp",
      issuer: "Synthetic Ω",
      label: "fixture@example.invalid",
      secret: "JBSWY3DPEHPK3PXP",
      otpType: "totp",
      algorithm: "SHA256",
      digits: 8,
      period: 45,
      note: "",
    },
    {
      ...metadata,
      id: hotpId,
      kind: "otp",
      issuer: "",
      label: "Counter only",
      secret: "JBSWY3DPEHPK3PXP",
      otpType: "hotp",
      algorithm: "SHA1",
      digits: 6,
      period: 0,
      counter: 9,
      note: "",
    },
    {
      ...metadata,
      id: "66666666-6666-4666-8666-666666666666",
      kind: "login",
      name: "Mail, work",
      username: "fixture@example.invalid",
      password: 'pa"ss,word\nwith newline',
      urls: ["https://mail.example.invalid/login", "https://example.invalid"],
      linkedOtpId: otpId,
      notes: " leading space",
      folderId,
    },
    {
      ...metadata,
      id: "66666666-6666-4666-8666-666666666667",
      kind: "login",
      name: "Inline code",
      username: "someone",
      password: "plain",
      urls: [],
      totp: "otpauth://totp/Inline?secret=JBSWY3DPEHPK3PXP",
      notes: "",
    },
    {
      ...metadata,
      id: "66666666-6666-4666-8666-666666666668",
      kind: "login",
      name: "Counter login",
      username: "counter",
      password: "plain",
      urls: ["https://counter.example.invalid"],
      linkedOtpId: hotpId,
      notes: "",
    },
    {
      ...metadata,
      id: "77777777-7777-4777-8777-777777777777",
      kind: "note",
      name: "Recovery codes",
      content: "café ∕ カフェ",
    },
    {
      ...metadata,
      id: "88888888-8888-4888-8888-888888888888",
      kind: "secret",
      name: "Deploy token",
      secretType: "token",
      value: "tok_synthetic",
      metadata: {},
      notes: "",
    },
  ],
  folders: [{ id: folderId, name: "Work" }],
  settings: { autoLockMinutes: 15, lockOnScreenLock: true },
  history: { journal: [], tombstones: [] },
};

describe("unencrypted JSON export", () => {
  it("writes every item of every kind with its secrets, the folders, and a warning about itself", () => {
    const text = decoder.decode(encodePlaintextJsonExport(payload));
    const document = JSON.parse(text) as Record<string, unknown>;
    expect(Object.keys(document)).toEqual([
      "type",
      "formatVersion",
      "encrypted",
      "warning",
      "exportedAt",
      "folders",
      "items",
    ]);
    expect(document).toMatchObject({
      type: PLAINTEXT_EXPORT_TYPE,
      formatVersion: 1,
      encrypted: false,
      warning: PLAINTEXT_EXPORT_WARNING,
      exportedAt: payload.exportedAt,
      folders: payload.folders,
      items: payload.items,
    });
    expect(text).toContain("JBSWY3DPEHPK3PXP");
    expect(text).toContain("tok_synthetic");
    expect(text).toContain("café ∕ カフェ");
    expect(text.startsWith("{\n  ")).toBe(true);
    expect(text.endsWith("}\n")).toBe(true);
  });

  it("carries a version 1 payload as items with no folders, and rejects anything else", () => {
    const v1: PortableBackupPayload = {
      schemaVersion: 1,
      exportedAt: payload.exportedAt,
      items: [payload.items[0] as Extract<(typeof payload.items)[number], { kind: "otp" }>],
      settings: payload.settings,
      history: payload.history,
    };
    const document = JSON.parse(decoder.decode(encodePlaintextJsonExport(v1))) as {
      folders: unknown[];
      items: unknown[];
    };
    expect(document.folders).toEqual([]);
    expect(document.items).toHaveLength(1);
    expect(() => encodePlaintextJsonExport({ ...payload, extra: true } as never)).toThrow();
  });
});

describe("logins CSV export", () => {
  it("writes one row per login in the common column order, quoted where needed", () => {
    const text = decoder.decode(encodeLoginsCsvExport(payload));
    const lines = text.split("\r\n");
    expect(lines.at(-1)).toBe("");
    expect(lines[0]).toBe(LOGINS_CSV_COLUMNS.join(","));
    expect(lines[0]).toBe("name,url,username,password,notes,totp");
    expect(lines).toHaveLength(5);
    expect(lines[1]).toBe(
      '"Mail, work",https://mail.example.invalid/login,fixture@example.invalid,"pa""ss,word\nwith newline"," leading space",otpauth://totp/Synthetic%20%CE%A9:fixture%40example.invalid?secret=JBSWY3DPEHPK3PXP&algorithm=SHA256&digits=8&issuer=Synthetic+%CE%A9&period=45',
    );
    expect(lines[2]).toBe(
      "Inline code,,someone,plain,,otpauth://totp/Inline?secret=JBSWY3DPEHPK3PXP",
    );
    expect(lines[3]).toBe(
      "Counter login,https://counter.example.invalid,counter,plain,,otpauth://hotp/Counter%20only?secret=JBSWY3DPEHPK3PXP&algorithm=SHA1&digits=6&counter=9",
    );
    expect(text).not.toContain("Recovery codes");
    expect(text).not.toContain("tok_synthetic");
  });

  it("writes only the header for a vault with no logins", () => {
    const text = decoder.decode(
      encodeLoginsCsvExport({ ...payload, items: payload.items.filter((i) => i.kind !== "login") }),
    );
    expect(text).toBe("name,url,username,password,notes,totp\r\n");
  });
});
