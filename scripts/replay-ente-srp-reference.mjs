import { createHash, timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";

const h = (...values) => createHash("sha256").update(Buffer.concat(values)).digest();
export const decodeSrpProtocolBase64 = (value) => {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 2048 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)
  )
    throw new Error("SRP transcript rejected");
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value) throw new Error("SRP transcript rejected");
  return Uint8Array.from(decoded);
};
const fromHex = (value) => {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length % 2 ||
    !/^[0-9a-f]+$/u.test(value)
  )
    throw new Error("SRP transcript rejected");
  return Buffer.from(value, "hex");
};
const integer = (value) => BigInt(`0x${value.toString("hex") || "0"}`);
const bytes = (value, length) => {
  if (value < 0n) throw new Error("SRP transcript rejected");
  let hex = value.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  const raw = Buffer.from(hex, "hex");
  if (raw.length > length) throw new Error("SRP transcript rejected");
  return Buffer.concat([Buffer.alloc(length - raw.length), raw]);
};
const pow = (base, exponent, modulus) => {
  let result = 1n;
  for (base %= modulus; exponent > 0n; exponent >>= 1n, base = (base * base) % modulus)
    if (exponent & 1n) result = (result * base) % modulus;
  return result;
};

// RFC 5054 4096-bit group, independently sourced from RFC 5054 Appendix A.
export const N_HEX = `FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD129024E08
8A67CC74020BBEA63B139B22514A08798E3404DDEF9519B3CD3A431B
302B0A6DF25F14374FE1356D6D51C245E485B576625E7EC6F44C42E9
A637ED6B0BFF5CB6F406B7EDEE386BFB5A899FA5AE9F24117C4B1FE6
49286651ECE45B3DC2007CB8A163BF0598DA48361C55D39A69163FA8
FD24CF5F83655D23DCA3AD961C62F356208552BB9ED529077096966D
670C354E4ABC9804F1746C08CA18217C32905E462E36CE3BE39E772C
180E86039B2783A2EC07A28FB5C55DF06F4C52C9DE2BCBF695581718
3995497CEA956AE515D2261898FA051015728E5A8AAAC42DAD33170D
04507A33A85521ABDF1CBA64ECFB850458DBEF0A8AEA71575D060C7D
B3970F85A6E1E4C7ABF5AE8CDB0933D71E8C94E04A25619DCEE3D226
1AD2EE6BF12FFA06D98A0864D87602733EC86A64521F2B18177B200C
BBE117577A615D6C770988C0BAD946E208E24FA074E5AB3143DB5BFC
E0FD108E4B82D120A92108011A723C12A787E6D788719A10BDBA5B26
99C327186AF4E23C1A946834B6150BDA2583E9CA2AD44CE8DBBBC2DB
04DE8EF92E8EFC141FBECAA6287C59474E6BC05D99B2964FA090C3A2
233BA186515BE7ED1F612970CEE2D7AFB81BDD762170481CD0069127
D5B05AA993B4EA988D8FDDC186FFB7DC90A6C08F4DF435C934063199
FFFFFFFFFFFFFFFF`
  .replace(/\s/gu, "")
  .toLowerCase();
const N = BigInt(`0x${N_HEX}`);
const G = 5n;
const PAD = 512;

export function replaySrpTranscript(t) {
  if (t.paddingBytes !== PAD || t.generator !== 5 || t.hash !== "SHA-256")
    throw new Error("SRP transcript rejected");
  const I = Buffer.from(t.identityUtf8, "utf8");
  const P = fromHex(t.loginKeyHex);
  const salt = fromHex(t.saltHex);
  const a = integer(fromHex(t.clientPrivateHex));
  const b = integer(fromHex(t.serverPrivateHex));
  if (!I.length || P.length !== 16 || !salt.length || a <= 0n || b <= 0n)
    throw new Error("SRP transcript rejected");
  const x = integer(h(salt, h(I, Buffer.from(":"), P)));
  const k = integer(h(bytes(N, PAD), bytes(G, PAD)));
  const verifier = pow(G, x, N);
  const Aint = pow(G, a, N);
  const Bint = (k * verifier + pow(G, b, N)) % N;
  if (Aint <= 0n || Aint >= N || Bint <= 0n || Bint >= N)
    throw new Error("SRP transcript rejected");
  const A = bytes(Aint, PAD);
  const B = bytes(Bint, PAD);
  const u = h(A, B);
  if (integer(u) === 0n) throw new Error("SRP transcript rejected");
  const S = bytes(pow((Bint - k * pow(G, x, N) + N * N) % N, a + integer(u) * x, N), PAD);
  const K = h(S);
  const M1 = h(A, B, S);
  const M2 = h(A, M1, K);
  return Object.fromEntries(
    Object.entries({ A, B, u, premaster: S, sessionKey: K, M1, M2 }).map(([key, value]) => [
      key,
      value.toString("hex"),
    ]),
  );
}

export function verifyExpectedReplay(t) {
  const r = replaySrpTranscript(t);
  const expected = {
    A: t.expectedAHex,
    B: t.serverPublicBHex,
    u: t.scramblingUHex,
    premaster: t.premasterSecretHex,
    sessionKey: t.expectedSessionKeyHex,
    M1: t.expectedM1Hex,
    M2: t.expectedM2Hex,
  };
  for (const [key, value] of Object.entries(expected)) {
    const actual = Buffer.from(r[key], "hex");
    const wanted = fromHex(value);
    if (actual.length !== wanted.length || !timingSafeEqual(actual, wanted))
      throw new Error(`SRP replay mismatch: ${key}`);
  }
  return r;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { readFile } = await import("node:fs/promises");
  for (const path of process.argv.slice(2))
    verifyExpectedReplay(JSON.parse(await readFile(path, "utf8")));
}
