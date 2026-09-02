import {
  createEnteSrpClient,
  decodeEnteSrpProtocolBase64,
} from "../../apps/extension/src/background/ente/srp-adapter";
import {
  createDeterministicEnteSrpClient,
  type DeterministicEnteSrpClientInput,
} from "../tooling/ente-srp-deterministic-adapter";
import current from "../fixtures/ente/srp-current-pin-transcript.json";
import legacy from "../fixtures/ente/srp-legacy-1.2.1-transcript.json";

const bytes = (value: string): Uint8Array =>
  Uint8Array.from(value.match(/../gu) ?? [], (byte) => Number.parseInt(byte, 16));
const hex = (value: Uint8Array): string =>
  Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");

function input(vector: typeof current): DeterministicEnteSrpClientInput {
  return {
    usernameUtf8: new TextEncoder().encode(vector.identityUtf8),
    passwordKey: bytes(vector.loginKeyHex),
    salt: bytes(vector.saltHex),
    clientPrivateEphemeral: bytes(vector.clientPrivateHex),
  };
}

function mustReject(operation: () => void): void {
  let rejected = false;
  try {
    operation();
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("SRP rejection missing");
}

function replay(vector: typeof current): void {
  const client = createDeterministicEnteSrpClient(input(vector));
  if (hex(client.clientPublicA()) !== vector.expectedAHex) throw new Error("SRP A");
  const proof = client.clientProof(bytes(vector.serverPublicBHex));
  if (hex(proof.M1) !== vector.expectedM1Hex) throw new Error("SRP M1");
  if (hex(proof.sessionKey) !== vector.expectedSessionKeyHex) throw new Error("SRP K");
  client.verifyServerProof(bytes(vector.expectedM2Hex));
  mustReject(() => client.verifyServerProof(bytes(vector.invalidM2Hex)));
  client.dispose();
}

export function runEnteSrpChecks(): void {
  replay(current);
  replay(legacy);
  mustReject(() => decodeEnteSrpProtocolBase64(current.negativeCases.malformedBase64));
  mustReject(() => decodeEnteSrpProtocolBase64(legacy.negativeCases.malformedBase64));
  if (!current.expectedAHex.startsWith("00")) throw new Error("SRP leading zero fixture");
  const invalidB = createDeterministicEnteSrpClient(input(current));
  mustReject(() => invalidB.clientProof(new Uint8Array(512)));
  invalidB.dispose();
  const production = createEnteSrpClient({
    usernameUtf8: new TextEncoder().encode(current.identityUtf8),
    passwordKey: bytes(current.loginKeyHex),
    salt: bytes(current.saltHex),
  });
  if (production.clientPublicA().length !== 512) throw new Error("SRP production A");
  production.dispose();
}
