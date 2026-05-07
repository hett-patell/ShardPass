import { SRP, SrpClient } from "fast-srp-hap";
import { Buffer } from "buffer";
import { deriveSubKeyBytes, toB64 } from "./crypto";
import type { SRPAttributes, SRPVerificationResponse } from "./types";
import { ENTE_CLIENT_PACKAGE } from "./types";

const b64ToBuffer = (b: string): Buffer => Buffer.from(b, "base64");
const bufferToB64 = (b: Buffer): string => b.toString("base64");

async function deriveSRPLoginSubKey(kekB64: string): Promise<string> {
  const sub = await deriveSubKeyBytes(kekB64, 32, 1, "loginctx");
  return toB64(sub.slice(0, 16));
}

async function generateSRPClient(
  srpSaltB64: string,
  srpUserID: string,
  loginSubKeyB64: string,
): Promise<SrpClient> {
  return new Promise<SrpClient>((resolve, reject) => {
    SRP.genKey((err: Error | null, clientKey: Buffer | null) => {
      if (err) return reject(err);
      resolve(
        new SrpClient(
          SRP.params["4096"],
          b64ToBuffer(srpSaltB64),
          Buffer.from(srpUserID),
          b64ToBuffer(loginSubKeyB64),
          clientKey!,
          false,
        ),
      );
    });
  });
}

export async function verifySRP(
  apiUrl: string,
  attrs: SRPAttributes,
  kekB64: string,
): Promise<SRPVerificationResponse> {
  const loginSubKey = await deriveSRPLoginSubKey(kekB64);
  const client = await generateSRPClient(attrs.srpSalt, attrs.srpUserID, loginSubKey);

  const srpA = bufferToB64(client.computeA());
  const createRes = await fetch(`${apiUrl}/users/srp/create-session`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Client-Package": ENTE_CLIENT_PACKAGE,
    },
    body: JSON.stringify({ srpUserID: attrs.srpUserID, srpA }),
  });
  if (!createRes.ok) {
    const txt = await createRes.text().catch(() => "");
    throw new Error(`srp/create-session failed (${createRes.status}): ${txt}`);
  }
  const { sessionID, srpB } = (await createRes.json()) as {
    sessionID: string;
    srpB: string;
  };

  client.setB(b64ToBuffer(srpB));
  const srpM1 = bufferToB64(client.computeM1());

  const verifyRes = await fetch(`${apiUrl}/users/srp/verify-session`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Client-Package": ENTE_CLIENT_PACKAGE,
    },
    body: JSON.stringify({ sessionID, srpUserID: attrs.srpUserID, srpM1 }),
  });
  if (verifyRes.status === 401) throw new Error("Incorrect password");
  if (!verifyRes.ok) {
    const txt = await verifyRes.text().catch(() => "");
    throw new Error(`srp/verify-session failed (${verifyRes.status}): ${txt}`);
  }
  const response = (await verifyRes.json()) as SRPVerificationResponse;
  client.checkM2(b64ToBuffer(response.srpM2));
  return response;
}
