import { createHash } from "node:crypto";
import { cp, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { deflateRawSync, deflateSync } from "node:zlib";

import { afterEach, describe, expect, it } from "vitest";

import {
  parseSecretAllowlist,
  REPORTABLE_RULE_IDS,
  scanSecretRoot,
  SECRET_SCANNER_SCHEMA_VERSION,
  verifySecretScanReport,
} from "../../scripts/scan-secrets.mjs";
import {
  parseProductionSourceManifest,
  scanProductionSources,
} from "../../scripts/scan-project1-production-sources.mjs";

const temporaryDirectories: string[] = [];
const emptyAllowlist = '{"schemaVersion":1,"scannerSchemaVersion":1,"allowances":[]}';

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1)
    value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(value: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of value) crc = (crcTable[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, data: Uint8Array): Buffer {
  const typeBytes = Buffer.from(type, "ascii");
  const header = Buffer.alloc(8);
  header.writeUInt32BE(data.length, 0);
  typeBytes.copy(header, 4);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([header, data, checksum]);
}
function png(...chunks: Buffer[]): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    pngChunk("IHDR", ihdr),
    ...chunks,
    pngChunk("IDAT", deflateSync(Buffer.from([0, 0, 0, 0, 0]))),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}
function uleb(value: number): Buffer {
  const result: number[] = [];
  do {
    const low = value & 0x7f;
    value >>>= 7;
    result.push(value === 0 ? low : low | 0x80);
  } while (value !== 0);
  return Buffer.from(result);
}
function wasmSection(id: number, data: Uint8Array): Buffer {
  return Buffer.concat([Buffer.from([id]), uleb(data.length), data]);
}
function wasm(...sections: Buffer[]): Buffer {
  return Buffer.concat([Buffer.from("0061736d01000000", "hex"), ...sections]);
}
function wasmString(value: string): Buffer {
  const bytes = Buffer.from(value);
  return Buffer.concat([uleb(bytes.length), bytes]);
}
function zip(name: string, value: string, method: 0 | 8): Buffer {
  const nameBytes = Buffer.from(name);
  const plain = Buffer.from(value);
  const compressed = method === 0 ? plain : deflateRawSync(plain);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(method, 8);
  local.writeUInt32LE(crc32(plain), 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(plain.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(method, 10);
  central.writeUInt32LE(crc32(plain), 16);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(plain.length, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  const centralOffset = local.length + nameBytes.length + compressed.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length + nameBytes.length, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  return Buffer.concat([local, nameBytes, compressed, central, nameBytes, eocd]);
}

async function fixture(
  files: Readonly<Record<string, string | Uint8Array>>,
  allowlist = emptyAllowlist,
): Promise<{ allowlistPath: string; root: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "shardpass-secret-scan-"));
  temporaryDirectories.push(root);
  for (const [relativePath, contents] of Object.entries(files)) {
    const target = path.join(root, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, contents);
  }
  const allowlistPath = path.join(
    await mkdtemp(path.join(tmpdir(), "shardpass-allowlist-")),
    "allowlist.json",
  );
  temporaryDirectories.push(path.dirname(allowlistPath));
  await writeFile(allowlistPath, allowlist);
  return { allowlistPath, root };
}

async function scan(
  files: Readonly<Record<string, string | Uint8Array>>,
  options: {
    allowlist?: string;
    mode?: "source" | "candidate";
    maxTextBytes?: number;
    maxBinaryBytes?: number;
  } = {},
) {
  const prepared = await fixture(files, options.allowlist);
  return scanSecretRoot({
    root: prepared.root,
    rootName: "synthetic-root",
    mode: options.mode ?? "source",
    allowlistPath: prepared.allowlistPath,
    maxTextBytes: options.maxTextBytes ?? 64 * 1024,
    maxBinaryBytes: options.maxBinaryBytes ?? 64 * 1024,
  });
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("generic Project 1 secret scanner", () => {
  it("exports schema version 1 and accepts clean source and candidate roots", async () => {
    expect(SECRET_SCANNER_SCHEMA_VERSION).toBe(1);
    for (const mode of ["source", "candidate"] as const) {
      const report = await scan(
        {
          "docs/readme.txt": "public documentation\n",
          "src/main.js": "export const ready = true;\n",
        },
        { mode },
      );
      expect(report).toMatchObject({
        schemaVersion: 1,
        mode,
        rootName: "synthetic-root",
        findings: [],
        allowancesUsed: [],
        filesScanned: 2,
        status: "PASS",
      });
      expect(() => verifySecretScanReport(report)).not.toThrow();
    }
  });

  it("uses deterministic bytewise normalized POSIX path ordering", async () => {
    const report = await scan({
      "z-last.txt": "otpauth://totp/z?secret=JBSWY3DPEHPK3PXP",
      "nested/b.txt": "otpauth://totp/b?secret=JBSWY3DPEHPK3PXP",
      "nested/a.txt": "otpauth://totp/a?secret=JBSWY3DPEHPK3PXP",
    });
    expect([...new Set(report.findings.map((entry) => entry.path))]).toEqual([
      "nested/a.txt",
      "nested/b.txt",
      "z-last.txt",
    ]);
    expect(report.rootDigest).toMatch(/^[a-f\d]{64}$/u);
  });

  it.each([
    [
      "serialized password",
      'const config = { "password": "Correct-Horse-Canary-42" };',
      "serialized-secret",
    ],
    [
      "serialized token",
      'export const value = { token: "tok_live_SYNTHETIC_CANARY_123456" };',
      "serialized-secret",
    ],
    ["OTP URI", "otpauth://totp/Example?secret=JBSWY3DPEHPK3PXP", "otpauth-uri"],
    ["base32 seed", "JBSWY3DPEHPK3PXP", "base32-secret"],
    ["bearer", "Authorization: Bearer SYNTHETIC_CANARY_TOKEN_1234567890", "bearer-token"],
    [
      "PEM",
      "-----BEGIN PRIVATE KEY-----\nSYNTHETIC-CANARY\n-----END PRIVATE KEY-----",
      "pem-private-key",
    ],
    ["entropy", 'const value = "8fQ2vL9xR4mZ7pT1cN6kW3yH5uJ0sA2d";', "high-entropy-literal"],
    ["secret log", "console.info(credential.password);", "secret-logging"],
    ["diagnostic log", "diagnostics.capture({ seed: value });", "secret-logging"],
    ["source map", "//# sourceMappingURL=app.js.map", "source-map"],
    ["test helper", "createVaultKeyMaterialForTesting()", "test-helper"],
    ["fixture marker", "TEST-ONLY synthetic credential fixture", "fixture-marker"],
  ])("detects %s without returning matched bytes", async (_label, text, ruleId) => {
    const report = await scan({ "sample.js": text });
    expect(report.status).toBe("FAIL");
    const detected = report.findings.find((finding) => finding.ruleId === ruleId);
    expect(detected).toBeDefined();
    expect(detected?.path).toBe("sample.js");
    expect(detected?.fileSha256).toBe(sha256(text));
    expect(detected?.matchSha256).toMatch(/^[a-f\d]{64}$/u);
    expect(detected?.startByte).toBeTypeOf("number");
    expect(detected?.endByte).toBeTypeOf("number");
    expect(detected?.count).toBeTypeOf("number");
    expect(JSON.stringify(report)).not.toContain("SYNTHETIC_CANARY");
  });

  it("detects contextual serialized, Base32, and entropy secrets in minified candidates", async () => {
    const report = await scan(
      {
        "app.js":
          'const a={password:"Correct-Horse-Canary-42",seed:"JBSWY3DPEHPK3PXP",token:"8fQ2vL9xR4mZ7pT1cN6kW3yH5uJ0sA2d"};',
        "data.json": '{"password":"Correct-Horse-Canary-42","seed":"JBSWY3DPEHPK3PXP"}',
        "page.html":
          '<script>globalThis.config={token:"8fQ2vL9xR4mZ7pT1cN6kW3yH5uJ0sA2d"}</script>',
        "clean.js":
          'const publicDigest="8fQ2vL9xR4mZ7pT1cN6kW3yH5uJ0sA2d",label="ABCDEFGHIJKLMNOP";',
      },
      { mode: "candidate" },
    );
    expect(report.findings.map(({ path, ruleId }) => `${path}:${ruleId}`)).toEqual(
      expect.arrayContaining([
        "app.js:serialized-secret",
        "app.js:base32-secret",
        "app.js:high-entropy-literal",
        "data.json:serialized-secret",
        "data.json:base32-secret",
        "page.html:serialized-secret",
        "page.html:high-entropy-literal",
      ]),
    );
    expect(report.findings.some(({ path }) => path === "clean.js")).toBe(false);
  });

  it("detects alphabetic-only serialized secrets in minified candidate JS, JSON, and HTML", async () => {
    const report = await scan(
      {
        "app.js":
          'const a={password:"CorrectHorseBatteryCanary",token:"AlphabeticTokenCanary",passphrase:"SeveralAlphabeticCanaryWords",apiKey:"AlphabeticApiKeyCanary"};',
        "data.json": '{"password":"CorrectHorseBatteryCanary","token":"AlphabeticTokenCanary"}',
        "page.html":
          '<script>globalThis.config={passphrase:"SeveralAlphabeticCanaryWords",apiKey:"AlphabeticApiKeyCanary"}</script>',
      },
      { mode: "candidate" },
    );
    expect(report.findings.filter(({ ruleId }) => ruleId === "serialized-secret")).toHaveLength(8);
  });

  it("rejects candidate metadata, property-access validation, and UI labels without allowlisting", async () => {
    const report = await scan(
      {
        "vault-access.js":
          'const metadata={autoComplete:"new-password":"current-password",type:"password"};',
        "vault.js": 'if(!BASE32.test(t.secret))t.secret="Enter a canonical Base32 secret.";',
        "popup.html": '<button>{hidden?"Conceal secret":"Reveal secret"}</button>',
      },
      { mode: "candidate" },
    );
    expect(report).toMatchObject({ findings: [], status: "PASS" });
  });

  it("detects actual minified object secret fields across JS, JSON, and HTML", async () => {
    const report = await scan(
      {
        "config.js":
          'const config={password:"CorrectHorseBatteryCanary",token:"AlphabeticTokenCanary"};',
        "config.json": '{"secret":"JBSWY3DPEHPK3PXP","passphrase":"SeveralAlphabeticCanaryWords"}',
        "config.html": '<meta data-config=\'{"apiKey":"AlphabeticApiKeyCanary"}\'>',
      },
      { mode: "candidate" },
    );
    expect(report.findings.filter(({ ruleId }) => ruleId === "serialized-secret")).toHaveLength(4);
    expect(report.findings.filter(({ ruleId }) => ruleId === "base32-secret")).toHaveLength(1);
  });

  it("excludes only exact reviewed benign serialized values in narrow paths", async () => {
    const report = await scan(
      {
        "popup/form.html": '<input autocomplete="current-password"><input type="password">',
        "schema/options.json": '{"token":"text","password":"hidden"}',
        "app.js": 'const x={password:"current-password",token:"one-time-code"};',
      },
      { mode: "candidate" },
    );
    expect(report.findings.map(({ path }) => path)).toEqual(["app.js", "app.js"]);
  });

  it("admits only canonical BOM-free UTF-8 text and preserves original byte ranges", async () => {
    const unicodePrefix = "π=";
    const value = 'password="SYNTHETIC_CANARY_PASSWORD"';
    const report = await scan({ "unicode.js": unicodePrefix + value });
    const finding = report.findings.find(({ ruleId }) => ruleId === "serialized-secret");
    expect(finding?.startByte).toBe(Buffer.byteLength(`${unicodePrefix}password="`));
    for (const bytes of [
      Buffer.from(`otpauth://totp/x?secret=JBSWY3DPEHPK3PXP`, "utf16le"),
      Buffer.from([0xfe, 0xff, 0x00, 0x61]),
      Buffer.from([0xef, 0xbb, 0xbf, 0x61]),
      Buffer.from([0xc0, 0xaf]),
      Buffer.from([0xe2, 0x28, 0xa1]),
      Buffer.from([0x61, 0x00, 0x62]),
    ])
      await expect(scan({ "invalid.js": bytes })).rejects.toThrow(/SECRET_SCAN_ENCODING/u);
  });

  it("detects environment files and candidate-only executable/network/test artifacts", async () => {
    const sourceReport = await scan({
      ".env.production": "PUBLIC_VALUE=clean",
      "src/app.js": "fetch('/local')",
    });
    expect(sourceReport.findings.map((finding) => finding.ruleId)).toContain("environment-file");
    expect(sourceReport.findings.map((finding) => finding.ruleId)).not.toContain(
      "candidate-network-executable",
    );

    const candidateReport = await scan(
      {
        "app.js": "fetch('https://example.invalid/api')",
        "fixtures/helper.js": "export const ready = true",
      },
      { mode: "candidate" },
    );
    expect(candidateReport.findings.map((finding) => finding.ruleId)).toEqual(
      expect.arrayContaining(["candidate-network-executable", "candidate-test-artifact"]),
    );
  });

  it("bounded-scans real stored and deflated ZIP members", async () => {
    for (const method of [0, 8] as const) {
      const report = await scan({
        [`archive-${method}.zip`]: zip(
          "nested/secret.js",
          'const config={password:"SYNTHETIC_CANARY_PASSWORD"}',
          method,
        ),
      });
      expect(report.findings).toEqual([
        expect.objectContaining({
          path: `archive-${method}.zip!/nested/secret.js`,
          ruleId: "serialized-secret",
        }),
      ]);
    }
  });

  it("strictly parses PNG and scans plain, compressed, and international text metadata", async () => {
    const secret = 'password="AlphabeticMetadataCanary"';
    const reports = await Promise.all([
      scan({ "plain.png": png(pngChunk("tEXt", Buffer.from(`Comment\0${secret}`))) }),
      scan({
        "compressed.png": png(
          pngChunk("zTXt", Buffer.concat([Buffer.from("Comment\0\0"), deflateSync(secret)])),
        ),
      }),
      scan({
        "international.png": png(
          pngChunk("iTXt", Buffer.concat([Buffer.from("Comment\0\0\0\0\0"), Buffer.from(secret)])),
        ),
      }),
    ]);
    for (const report of reports) {
      expect(report.findings).toHaveLength(1);
      const [finding] = report.findings;
      expect(finding?.ruleId).toBe("serialized-secret");
      expect(finding?.path).toMatch(/\.png!\/(?:tEXt|zTXt|iTXt)-2\.txt/u);
    }
    await expect(
      scan({ "clean.png": png(pngChunk("tEXt", Buffer.from("Comment\0public image"))) }),
    ).resolves.toMatchObject({ status: "PASS" });
  });

  it("fails closed for malformed, truncated, reordered, trailing, unknown-critical, and bomb PNGs", async () => {
    const valid = png();
    const badCrc = Buffer.from(valid);
    badCrc[29] = (badCrc[29] ?? 0) ^ 1;
    const trailing = Buffer.concat([valid, Buffer.from([0])]);
    const reordered = Buffer.concat([
      Buffer.from("89504e470d0a1a0a", "hex"),
      pngChunk("IDAT", Buffer.from([1])),
      valid.subarray(8, valid.length),
    ]);
    const unknownCritical = png(pngChunk("ABCD", Buffer.alloc(0)));
    const bomb = png(
      pngChunk(
        "zTXt",
        Buffer.concat([Buffer.from("Comment\0\0"), deflateSync("A".repeat(100_000))]),
      ),
    );
    for (const malformed of [
      valid.subarray(0, valid.length - 1),
      badCrc,
      trailing,
      reordered,
      unknownCritical,
    ])
      await expect(scan({ "bad.png": malformed })).rejects.toThrow(/SECRET_SCAN_MALFORMED_PNG/u);
    await expect(scan({ "bomb.png": bomb }, { maxBinaryBytes: 120_000 })).rejects.toThrow(
      /SECRET_SCAN_PNG_LIMIT/u,
    );
  });

  it("strictly parses WASM and scans custom, import, and export strings without scanning code bytes", async () => {
    const custom = wasmSection(
      0,
      Buffer.concat([wasmString("metadata"), Buffer.from('token="AlphabeticWasmCanary"')]),
    );
    const imports = wasmSection(
      2,
      Buffer.concat([
        uleb(1),
        wasmString("password"),
        wasmString("AlphabeticImportCanary"),
        Buffer.from([0, 0]),
      ]),
    );
    const exports = wasmSection(
      7,
      Buffer.concat([uleb(1), wasmString("secretAlphabeticExportCanary"), Buffer.from([0, 0])]),
    );
    const report = await scan({ "names.wasm": wasm(custom, imports, exports) });
    expect(report.findings.map(({ ruleId }) => ruleId)).toContain("serialized-secret");
    await expect(
      scan({
        "code.wasm": wasm(
          wasmSection(
            10,
            Buffer.concat([uleb(1), uleb(30), Buffer.from('token="AlphabeticCodeCanary"')]),
          ),
        ),
      }),
    ).resolves.toMatchObject({ status: "PASS" });
  });

  it("fails closed for malformed, noncanonical, reordered, trailing, and bounded WASM", async () => {
    const malformed = [
      Buffer.from("0061736d", "hex"),
      Buffer.from("0061736d02000000", "hex"),
      wasm(wasmSection(2, Buffer.from([0])), wasmSection(1, Buffer.from([0]))),
      Buffer.concat([wasm(), Buffer.from([1])]),
      Buffer.concat([Buffer.from("0061736d01000000", "hex"), Buffer.from([0, 0x80, 0])]),
    ];
    for (const bytes of malformed)
      await expect(scan({ "bad.wasm": bytes })).rejects.toThrow(/SECRET_SCAN_MALFORMED_WASM/u);
    await expect(
      scan(
        {
          "large.wasm": wasm(
            wasmSection(0, Buffer.concat([wasmString("x"), Buffer.alloc(70_000)])),
          ),
        },
        { maxBinaryBytes: 80_000 },
      ),
    ).rejects.toThrow(/SECRET_SCAN_WASM_LIMIT/u);
  });

  it("fails closed for malformed, truncated, traversal, duplicate, and bounded ZIP inputs", async () => {
    const valid = zip("nested/clean.js", "export const ready=true", 8);
    await expect(scan({ "truncated.zip": valid.subarray(0, valid.length - 1) })).rejects.toThrow(
      /SECRET_SCAN_MALFORMED_ZIP/u,
    );
    await expect(scan({ "fake.zip": Buffer.from("504b030400000000", "hex") })).rejects.toThrow(
      /SECRET_SCAN_MALFORMED_ZIP/u,
    );
    await expect(scan({ "traversal.zip": zip("../escape.js", "clean", 0) })).rejects.toThrow(
      /SECRET_SCAN_MALFORMED_ZIP/u,
    );
    const bomb = zip("bomb.txt", "A".repeat(20_000), 8);
    await expect(scan({ "bomb.zip": bomb }, { maxBinaryBytes: 25_000 })).rejects.toThrow(
      /SECRET_SCAN_ZIP_LIMIT/u,
    );
  });

  it("fails closed for malformed, unknown, and oversized inputs", async () => {
    await expect(scan({ "bad.json": "{" })).rejects.toThrow(/SECRET_SCAN_MALFORMED/u);
    await expect(scan({ "unknown.bin": new Uint8Array([0, 1, 2, 3, 4]) })).rejects.toThrow(
      /SECRET_SCAN_UNKNOWN_TYPE/u,
    );
    await expect(
      scan({ "large.bin": new Uint8Array(33).fill(1) }, { maxBinaryBytes: 32 }),
    ).rejects.toThrow(/SECRET_SCAN_BINARY_LIMIT/u);
    await expect(scan({ "large.txt": "x".repeat(33) }, { maxTextBytes: 32 })).rejects.toThrow(
      /SECRET_SCAN_TEXT_LIMIT/u,
    );
  });

  it("rejects symlinks, non-regular roots, unsafe and unstable paths", async () => {
    const prepared = await fixture({ "safe.txt": "clean" });
    await symlink(path.join(prepared.root, "safe.txt"), path.join(prepared.root, "linked.txt"));
    await expect(
      scanSecretRoot({
        root: prepared.root,
        rootName: "root",
        mode: "source",
        allowlistPath: prepared.allowlistPath,
        maxTextBytes: 1024,
        maxBinaryBytes: 1024,
      }),
    ).rejects.toThrow(/SECRET_SCAN_NONREGULAR/u);

    await expect(
      scanSecretRoot({
        root: path.join(prepared.root, "safe.txt"),
        rootName: "root",
        mode: "source",
        allowlistPath: prepared.allowlistPath,
        maxTextBytes: 1024,
        maxBinaryBytes: 1024,
      }),
    ).rejects.toThrow(/SECRET_SCAN_ROOT/u);
    await expect(scan({ "e\u0301.txt": "clean", "é.txt": "clean" })).rejects.toThrow(
      /SECRET_SCAN_UNSTABLE_PATH|SECRET_SCAN_PATH_COLLISION/u,
    );
  });
});

describe("canonical exact secret allowances", () => {
  const secretText = "otpauth://totp/ScannerCanary?secret=JBSWY3DPEHPK3PXP";

  async function exactAllowance(overrides: Readonly<Record<string, unknown>> = {}) {
    const initial = await scan({ "fixtures/canary.txt": secretText });
    const finding = initial.findings.find((item) => item.ruleId === "otpauth-uri");
    expect(finding).toBeDefined();
    return {
      schemaVersion: 1,
      scannerSchemaVersion: 1,
      mode: "source",
      ruleId: finding?.ruleId,
      path: finding?.path,
      fileSha256: finding?.fileSha256,
      matchSha256: finding?.matchSha256,
      startByte: finding?.startByte,
      endByte: finding?.endByte,
      count: finding?.count,
      rationale: "scanner-test-canary",
      ...overrides,
    };
  }

  it("allows only an exact authorized synthetic finding and records no match bytes", async () => {
    const allowance = await exactAllowance();
    const allowlist = JSON.stringify({
      schemaVersion: 1,
      scannerSchemaVersion: 1,
      allowances: [allowance],
    });
    const report = await scan({ "fixtures/canary.txt": secretText }, { allowlist });
    expect(report.status).toBe("PASS");
    expect(report.allowancesUsed).toEqual([allowance]);
    expect(report.findings).toEqual([]);
    expect(JSON.stringify(report)).not.toContain(secretText);
  });

  it("permits all synthetic matches only when every exact finding is independently authorized", async () => {
    const initial = await scan({ "fixtures/canary.txt": secretText });
    const allowances = initial.findings.map((finding) => ({
      schemaVersion: 1,
      scannerSchemaVersion: 1,
      mode: "source",
      ruleId: finding.ruleId,
      path: finding.path,
      fileSha256: finding.fileSha256,
      matchSha256: finding.matchSha256,
      startByte: finding.startByte,
      endByte: finding.endByte,
      count: finding.count,
      rationale: "scanner-test-canary",
    }));
    const report = await scan(
      { "fixtures/canary.txt": secretText },
      { allowlist: JSON.stringify({ schemaVersion: 1, scannerSchemaVersion: 1, allowances }) },
    );
    expect(report).toMatchObject({ status: "PASS", findings: [] });
    expect(report.allowancesUsed).toHaveLength(allowances.length);
  });

  it.each([
    ["wrong mode", { mode: "candidate" }],
    ["wrong rule", { ruleId: "pem-private-key" }],
    ["wrong schema", { scannerSchemaVersion: 2 }],
    ["wrong file hash", { fileSha256: "0".repeat(64) }],
    ["wrong match hash", { matchSha256: "0".repeat(64) }],
    ["wrong range", { startByte: 1 }],
    ["wrong count", { count: 99 }],
    ["moved path", { path: "other/canary.txt" }],
  ])("fails an unused or mismatched exact allowance: %s", async (_label, overrides) => {
    const allowance = await exactAllowance(overrides);
    const allowlist = JSON.stringify({
      schemaVersion: 1,
      scannerSchemaVersion: 1,
      allowances: [allowance],
    });
    await expect(scan({ "fixtures/canary.txt": secretText }, { allowlist })).rejects.toThrow(
      /SECRET_SCAN_UNUSED_ALLOWANCE|SECRET_SCAN_ALLOWLIST/u,
    );
  });

  it("rejects broad, duplicate, overlapping, unknown-key, and noncanonical allowance forms", async () => {
    const allowance = await exactAllowance();
    const invalid = [
      { ...allowance, path: "fixtures/*" },
      { ...allowance, path: "canary.txt", extension: ".txt" },
      { ...allowance, line: 1 },
      { ...allowance, entropy: true },
      { ...allowance, generated: true },
      { ...allowance, ruleId: "forged-unknown-rule" },
    ];
    for (const entry of invalid) {
      expect(() =>
        parseSecretAllowlist(
          JSON.stringify({ schemaVersion: 1, scannerSchemaVersion: 1, allowances: [entry] }),
        ),
      ).toThrow(/SECRET_SCAN_ALLOWLIST/u);
    }
    expect(() =>
      parseSecretAllowlist(
        JSON.stringify({
          schemaVersion: 1,
          scannerSchemaVersion: 1,
          allowances: [allowance, allowance],
        }),
      ),
    ).toThrow(/SECRET_SCAN_ALLOWLIST/u);
    const startByte = Number(allowance.startByte);
    const endByte = Number(allowance.endByte);
    for (const second of [
      { ...allowance, ruleId: "base32-secret" },
      { ...allowance, ruleId: "base32-secret", startByte: startByte + 1, endByte: endByte + 3 },
      { ...allowance, ruleId: "base32-secret", startByte: startByte - 1, endByte: endByte + 1 },
    ])
      expect(() =>
        parseSecretAllowlist(
          JSON.stringify({
            schemaVersion: 1,
            scannerSchemaVersion: 1,
            allowances: [allowance, second],
          }),
        ),
      ).toThrow(/SECRET_SCAN_ALLOWLIST/u);
    expect(() =>
      parseSecretAllowlist(
        JSON.stringify({
          schemaVersion: 1,
          scannerSchemaVersion: 1,
          allowances: [
            allowance,
            {
              ...allowance,
              ruleId: "base32-secret",
              startByte: endByte,
              endByte: endByte + 1,
            },
          ],
        }),
      ),
    ).not.toThrow();
    expect(() =>
      parseSecretAllowlist('{ "schemaVersion": 1, "scannerSchemaVersion": 1, "allowances": [] }'),
    ).toThrow(/SECRET_SCAN_ALLOWLIST/u);
  });

  it("publishes the complete explicit set of regex and procedural reportable rule IDs", () => {
    expect(REPORTABLE_RULE_IDS).toEqual([
      "base32-secret",
      "bearer-token",
      "candidate-allowlist",
      "candidate-network-executable",
      "candidate-test-artifact",
      "environment-file",
      "fixture-marker",
      "high-entropy-literal",
      "otpauth-uri",
      "pem-private-key",
      "secret-logging",
      "serialized-secret",
      "source-map",
      "test-helper",
    ]);
  });

  it("rejects forged reports with unknown, malformed, unsorted, duplicate, or mismatched nested data", async () => {
    const report = await scan({ "a.txt": "otpauth://totp/a?secret=JBSWY3DPEHPK3PXP" });
    const finding = report.findings[0];
    expect(finding).toBeDefined();
    const forgeries: unknown[] = [
      { ...report, files: [] },
      { ...report, findings: [{ ...finding, extra: true }] },
      { ...report, findings: [{ ...finding, ruleId: "forged-unknown-rule" }] },
      { ...report, findings: [{ ...finding, path: "../escape" }] },
      { ...report, findings: [{ ...finding, fileSha256: finding?.fileSha256.toUpperCase() }] },
      { ...report, findings: [{ ...finding, startByte: finding?.endByte }] },
      { ...report, findings: [finding, finding] },
      {
        ...report,
        findings: [
          { ...finding, path: "z.txt" },
          { ...finding, path: "a.txt", matchSha256: "0".repeat(64) },
        ],
      },
      {
        ...report,
        allowancesUsed: [
          {
            schemaVersion: 1,
            scannerSchemaVersion: 1,
            mode: "candidate",
            ...finding,
            rationale: "scanner-test-canary",
          },
        ],
      },
    ];
    for (const forged of forgeries)
      expect(() => verifySecretScanReport(forged as never)).toThrow(/SECRET_SCAN_REPORT/u);
  });

  it("forbids an allowlist copied into candidate output", async () => {
    await expect(
      scan({ "config/secret-allowlist.json": emptyAllowlist }, { mode: "candidate" }),
    ).resolves.toMatchObject({
      status: "FAIL",
      findings: [expect.objectContaining({ ruleId: "candidate-allowlist" })],
    });
  });

  it("scans every closed production root with the empty allowlist and catches a canary in each", async () => {
    const project = await mkdtemp(path.join(tmpdir(), "shardpass-production-source-"));
    temporaryDirectories.push(project);
    const manifestText = await readFile(
      path.resolve("config/project1-production-source-manifest.json"),
      "utf8",
    );
    const manifest = parseProductionSourceManifest(manifestText);
    const safeContents = (sourcePath: string) =>
      sourcePath.endsWith(".json") ? '{"safe":true}' : "export const safe = true;\n";
    for (const sourcePath of manifest.files) {
      const target = path.join(project, sourcePath);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, safeContents(sourcePath));
    }
    await cp(
      path.resolve("config/project1-secret-allowlist-empty.json"),
      path.join(project, "empty.json"),
    );
    const clean = await scanProductionSources({
      projectRoot: project,
      manifestPath: path.join(project, "manifest.json"),
      manifestText,
      allowlistPath: path.join(project, "empty.json"),
    });
    expect(clean.status).toBe("PASS");
    expect(clean.reports).toHaveLength(manifest.roots.length);
    expect(clean.eligibleFileCount).toBe(manifest.files.length);

    const unlistedEligible = [
      "apps/extension/src/unlisted.ts",
      "packages/domain/src/unlisted.ts",
      "scripts/unlisted.mjs",
      "tools/security/unlisted.ts",
      "vite.injected.config.ts",
      "docs/security/unlisted.md",
    ];
    for (const sourcePath of unlistedEligible) {
      const target = path.join(project, sourcePath);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, "safe\n");
      await expect(
        scanProductionSources({
          projectRoot: project,
          manifestPath: path.join(project, "manifest.json"),
          manifestText,
          allowlistPath: path.join(project, "empty.json"),
        }),
        sourcePath,
      ).rejects.toThrow("PRODUCTION_SOURCE_MANIFEST_CLOSURE_INVALID");
      await rm(target);
    }

    const stale = JSON.parse(manifestText) as {
      roots: { name: string; files: string[] }[];
    };
    const staleTools = stale.roots.find((root) => root.name === "tools-production");
    expect(staleTools).toBeDefined();
    staleTools?.files.push("tools/zz-stale.ts");
    const staleText = JSON.stringify(stale);
    expect(() => parseProductionSourceManifest(staleText)).not.toThrow();
    await expect(
      scanProductionSources({
        projectRoot: project,
        manifestPath: path.join(project, "manifest.json"),
        manifestText: staleText,
        allowlistPath: path.join(project, "empty.json"),
      }),
    ).rejects.toThrow("PRODUCTION_SOURCE_MANIFEST_CLOSURE_INVALID");

    for (const sourceRoot of manifest.roots) {
      const sourcePath = sourceRoot.files[0];
      expect(sourcePath).toBeDefined();
      if (!sourcePath) throw new Error("test manifest root has no files");
      const canary = sourcePath.endsWith(".json")
        ? '{"token":"Bearer injected-production-secret"}'
        : 'const token = "Bearer injected-production-secret";\n';
      await writeFile(path.join(project, sourcePath), canary);
      const result = await scanProductionSources({
        projectRoot: project,
        manifestPath: path.join(project, "manifest.json"),
        manifestText,
        allowlistPath: path.join(project, "empty.json"),
      });
      expect(result.status, sourceRoot.name).toBe("FAIL");
      expect(
        result.reports
          .find((report) => report.rootName === sourceRoot.name)
          ?.findings.some(
            (finding) => finding.ruleId === "bearer-token" && finding.path === sourcePath,
          ),
        sourceRoot.name,
      ).toBe(true);
      await writeFile(path.join(project, sourcePath), safeContents(sourcePath));
    }
  });
});
