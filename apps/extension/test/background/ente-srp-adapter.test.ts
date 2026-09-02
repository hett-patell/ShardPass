import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { createEnteSrpClient } from "../../src/background/ente/srp-adapter";
import { createDeterministicEnteSrpClient } from "../../../../tests/tooling/ente-srp-deterministic-adapter";

type Transcript = Readonly<{
  framing: "legacy-shardpass-1.2.1" | "ente-current-pin";
  identityUtf8: string;
  saltHex: string;
  loginKeyHex: string;
  clientPrivateHex: string;
  serverPublicBHex: string;
  expectedAHex: string;
  expectedM1Hex: string;
  expectedM2Hex: string;
  expectedSessionKeyHex: string;
}>;

const hex = (value: string) => Uint8Array.from(Buffer.from(value, "hex"));
const fixture = async (name: string): Promise<Transcript> =>
  JSON.parse(
    await readFile(new URL(`../../../../tests/fixtures/ente/${name}`, import.meta.url), "utf8"),
  ) as Transcript;

for (const name of ["srp-legacy-1.2.1-transcript.json", "srp-current-pin-transcript.json"]) {
  describe(name, () => {
    it("replays A, padded M1, session key, and M2 with caller-supplied secret", async () => {
      const vector = await fixture(name);
      const client = createDeterministicEnteSrpClient({
        usernameUtf8: new TextEncoder().encode(vector.identityUtf8),
        passwordKey: hex(vector.loginKeyHex),
        salt: hex(vector.saltHex),
        clientPrivateEphemeral: hex(vector.clientPrivateHex),
      });

      expect(Buffer.from(client.clientPublicA()).toString("hex")).toBe(vector.expectedAHex);
      const proof = client.clientProof(hex(vector.serverPublicBHex));
      expect(Buffer.from(proof.M1).toString("hex")).toBe(vector.expectedM1Hex);
      expect(Buffer.from(proof.sessionKey).toString("hex")).toBe(vector.expectedSessionKeyHex);
      expect(() => client.verifyServerProof(hex(vector.expectedM2Hex))).not.toThrow();

      const invalidM2 = hex(vector.expectedM2Hex);
      invalidM2[0] = (invalidM2[0] ?? 0) ^ 1;
      expect(() => client.verifyServerProof(invalidM2)).toThrow("Ente SRP proof rejected");
      client.dispose();
      expect(() => client.clientPublicA()).toThrow("Ente SRP client disposed");
    });
  });
}

describe("Ente SRP input boundary", () => {
  it("owns production entropy internally through WebCrypto", async () => {
    const vector = await fixture("srp-current-pin-transcript.json");
    const input = {
      usernameUtf8: new TextEncoder().encode(vector.identityUtf8),
      passwordKey: hex(vector.loginKeyHex),
      salt: hex(vector.saltHex),
    };
    const first = createEnteSrpClient(input);
    const second = createEnteSrpClient(input);
    expect(first.clientPublicA()).not.toEqual(second.clientPublicA());
    first.dispose();
    second.dispose();
  });

  it("rejects malformed lengths, invalid B, and premature M2", async () => {
    const vector = await fixture("srp-current-pin-transcript.json");
    const input = {
      usernameUtf8: new TextEncoder().encode(vector.identityUtf8),
      passwordKey: hex(vector.loginKeyHex),
      salt: hex(vector.saltHex),
    };
    expect(() => createEnteSrpClient({ ...input, passwordKey: new Uint8Array(15) })).toThrow(
      "Ente SRP input rejected",
    );
    const client = createDeterministicEnteSrpClient({
      ...input,
      clientPrivateEphemeral: hex(vector.clientPrivateHex),
    });
    expect(() => client.verifyServerProof(new Uint8Array(32))).toThrow("Ente SRP proof rejected");
    expect(() => client.clientProof(new Uint8Array(512))).toThrow("Ente SRP input rejected");
    expect(() => client.clientProof(new Uint8Array(513))).toThrow("Ente SRP input rejected");
    client.dispose();
  });
});
