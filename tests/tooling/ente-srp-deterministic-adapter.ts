import { Buffer } from "buffer";
import { SrpClient, SRP } from "../../apps/extension/node_modules/fast-srp-hap";

import type { EnteSrpClient } from "../../apps/extension/src/background/ente/srp-adapter";

const GROUP_BYTES = 512;
const PRIVATE_BYTES = 64;

export type DeterministicEnteSrpClientInput = Readonly<{
  usernameUtf8: Uint8Array;
  passwordKey: Uint8Array;
  salt: Uint8Array;
  clientPrivateEphemeral: Uint8Array;
}>;

export function createDeterministicEnteSrpClient(
  input: DeterministicEnteSrpClientInput,
): EnteSrpClient {
  if (
    input.usernameUtf8.length === 0 ||
    input.usernameUtf8.length > 320 ||
    input.passwordKey.length !== 16 ||
    input.salt.length === 0 ||
    input.salt.length > 1024 ||
    input.clientPrivateEphemeral.length !== PRIVATE_BYTES ||
    input.clientPrivateEphemeral.every((value) => value === 0)
  )
    throw new Error("Ente SRP input rejected");
  const identity = Buffer.from(input.usernameUtf8);
  const passwordKey = Buffer.from(input.passwordKey);
  const salt = Buffer.from(input.salt);
  const privateEphemeral = Buffer.from(input.clientPrivateEphemeral);
  const client = new SrpClient(
    SRP.params[4096],
    salt,
    identity,
    passwordKey,
    privateEphemeral,
    false,
  );
  let proofComputed = false;
  let disposed = false;
  const active = () => {
    if (disposed) throw new Error("Ente SRP client disposed");
  };
  return {
    clientPublicA() {
      active();
      const result = client.computeA();
      if (result.length !== GROUP_BYTES) throw new Error("Ente SRP input rejected");
      return Uint8Array.from(result);
    },
    clientProof(serverPublicB) {
      active();
      if (
        proofComputed ||
        serverPublicB.length !== GROUP_BYTES ||
        serverPublicB.every((value) => value === 0)
      )
        throw new Error("Ente SRP input rejected");
      try {
        client.setB(Buffer.from(serverPublicB));
        proofComputed = true;
        return {
          M1: Uint8Array.from(client.computeM1()),
          sessionKey: Uint8Array.from(client.computeK()),
        };
      } catch {
        throw new Error("Ente SRP input rejected");
      }
    },
    verifyServerProof(M2) {
      active();
      if (!proofComputed || M2.length !== 32) throw new Error("Ente SRP proof rejected");
      try {
        client.checkM2(Buffer.from(M2));
      } catch {
        throw new Error("Ente SRP proof rejected");
      }
    },
    dispose() {
      disposed = true;
      identity.fill(0);
      passwordKey.fill(0);
      salt.fill(0);
      privateEphemeral.fill(0);
    },
  };
}
