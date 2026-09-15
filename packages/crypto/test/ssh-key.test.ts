import { createHash, createPublicKey, generateKeyPairSync } from "node:crypto";

import { describe, expect, it } from "vitest";

import { generateSshKey, inspectSshPrivateKey, isSshPrivateKey } from "../src/ssh-key";

describe("SSH keys", () => {
  it("makes an OpenSSH Ed25519 key that reads back with the same public key and fingerprint", async () => {
    const key = await generateSshKey("ed25519", "alice@laptop");
    expect(key.keyType).toBe("ssh-ed25519");
    expect(key.privateKey).toMatch(
      /^-----BEGIN OPENSSH PRIVATE KEY-----\n[\s\S]+\n-----END OPENSSH PRIVATE KEY-----\n$/u,
    );
    expect(key.publicKey).toMatch(
      /^ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI[A-Za-z0-9+/]{40,} alice@laptop$/u,
    );
    expect(key.fingerprint).toMatch(/^SHA256:[A-Za-z0-9+/]{43}$/u);
    const info = await inspectSshPrivateKey(key.privateKey);
    expect(info).toEqual({
      keyType: "ssh-ed25519",
      publicKey: key.publicKey,
      fingerprint: key.fingerprint,
      comment: "alice@laptop",
      encrypted: false,
    });
    // The blob is string("ssh-ed25519") + string(32 bytes), and the fingerprint is its SHA-256.
    const blob = Buffer.from(key.publicKey.split(" ")[1] ?? "", "base64");
    expect(blob.subarray(0, 4)).toEqual(Buffer.from([0, 0, 0, 11]));
    expect(blob.subarray(4, 15).toString()).toBe("ssh-ed25519");
    expect(blob.subarray(15, 19)).toEqual(Buffer.from([0, 0, 0, 32]));
    expect(blob.length).toBe(51);
    expect(key.fingerprint).toBe(
      `SHA256:${createHash("sha256").update(blob).digest("base64").replace(/=+$/u, "")}`,
    );
  });

  it("makes an OpenSSH RSA key that Node can read and that reads back", async () => {
    const key = await generateSshKey("rsa", "", 2048);
    expect(key.keyType).toBe("ssh-rsa");
    const info = await inspectSshPrivateKey(key.privateKey);
    expect(info).toMatchObject({
      keyType: "ssh-rsa",
      publicKey: key.publicKey,
      fingerprint: key.fingerprint,
      comment: "",
    });
    // The blob's modulus and exponent make a 2048-bit RSA key Node accepts.
    const blob = Buffer.from(key.publicKey.split(" ")[1] ?? "", "base64");
    const parts: Buffer[] = [];
    for (let offset = 0; offset < blob.length;) {
      const length = blob.readUInt32BE(offset);
      parts.push(blob.subarray(offset + 4, offset + 4 + length));
      offset += 4 + length;
    }
    expect(parts[0]?.toString()).toBe("ssh-rsa");
    const strip = (part: Buffer) => (part[0] === 0 ? part.subarray(1) : part);
    const node = createPublicKey({
      key: {
        kty: "RSA",
        e: strip(parts[1]!).toString("base64url"),
        n: strip(parts[2]!).toString("base64url"),
      },
      format: "jwk",
    });
    expect(node.asymmetricKeyDetails?.modulusLength).toBe(2048);
  });

  it("reads PKCS#8, PEM RSA and PEM EC keys, and knows an encrypted one when it sees it", async () => {
    const ed = generateKeyPairSync("ed25519", {
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    const edInfo = await inspectSshPrivateKey(ed.privateKey);
    const edJwk = createPublicKey(ed.publicKey).export({ format: "jwk" }) as { x: string };
    expect(edInfo?.keyType).toBe("ssh-ed25519");
    const edBlob = Buffer.from(edInfo?.publicKey.split(" ")[1] ?? "", "base64");
    expect(edBlob.subarray(edBlob.length - 32)).toEqual(Buffer.from(edJwk.x, "base64url"));

    const rsa = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs1", format: "pem" },
      publicKeyEncoding: { type: "pkcs1", format: "pem" },
    });
    const rsaInfo = await inspectSshPrivateKey(rsa.privateKey);
    expect(rsaInfo?.keyType).toBe("ssh-rsa");
    expect(rsaInfo?.publicKey).toMatch(/^ssh-rsa AAAAB3NzaC1yc2E/u);

    const ec = generateKeyPairSync("ec", {
      namedCurve: "P-256",
      privateKeyEncoding: { type: "sec1", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    const ecInfo = await inspectSshPrivateKey(ec.privateKey);
    expect(ecInfo?.keyType).toBe("ecdsa-sha2-nistp256");
    expect(ecInfo?.publicKey).toMatch(/^ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTY/u);

    const locked = generateKeyPairSync("ed25519", {
      privateKeyEncoding: { type: "pkcs8", format: "pem", cipher: "aes-256-cbc", passphrase: "pw" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    expect(await inspectSshPrivateKey(locked.privateKey)).toEqual({
      keyType: "",
      publicKey: "",
      fingerprint: "",
      comment: "",
      encrypted: true,
    });
    expect(isSshPrivateKey(locked.privateKey)).toBe(true);
    expect(isSshPrivateKey("hunter2")).toBe(false);
    expect(await inspectSshPrivateKey("hunter2")).toBeNull();
  });

  it("reads a PuTTY file's public part", async () => {
    const key = await generateSshKey("ed25519", "putty");
    const blob = key.publicKey.split(" ")[1] ?? "";
    const ppk = [
      "PuTTY-User-Key-File-3: ssh-ed25519",
      "Encryption: none",
      "Comment: putty",
      "Public-Lines: 2",
      blob.slice(0, 40),
      blob.slice(40),
      "Private-Lines: 1",
      "AAAA",
      "Private-MAC: 00",
    ].join("\n");
    expect(await inspectSshPrivateKey(ppk)).toEqual({
      keyType: "ssh-ed25519",
      publicKey: key.publicKey.replace(" putty", "") + " putty",
      fingerprint: key.fingerprint,
      comment: "putty",
      encrypted: false,
    });
  });
});
