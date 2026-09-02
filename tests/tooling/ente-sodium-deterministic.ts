import sodium from "../../apps/extension/node_modules/libsodium-wrappers-sumo/dist/modules-sumo-esm/libsodium-wrappers.mjs";

export async function deterministicSodiumKeypair(
  seed: Uint8Array,
): Promise<Readonly<{ publicKey: Uint8Array; privateKey: Uint8Array }>> {
  await sodium.ready;
  if (seed.length !== sodium.crypto_box_SEEDBYTES) throw new Error("Sodium test seed rejected");
  const pair = sodium.crypto_box_seed_keypair(seed);
  return {
    publicKey: Uint8Array.from(pair.publicKey),
    privateKey: Uint8Array.from(pair.privateKey),
  };
}
