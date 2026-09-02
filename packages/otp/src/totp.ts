import { OtpItemSchema, type OtpItem } from "@shardpass/domain";

import { OtpError } from "./error";
import { generateHotp, type OtpCrypto } from "./hotp";
import { generateSteamCode } from "./steam";

export interface GeneratedOtp {
  readonly code: string;
  readonly counter: number;
  readonly remaining?: number;
  readonly expiresAt?: number;
}

export async function generateOtp(
  candidate: OtpItem,
  nowMs: number,
  crypto?: OtpCrypto,
): Promise<GeneratedOtp> {
  const parsed = OtpItemSchema.safeParse(candidate);
  if (!parsed.success) throw new OtpError("OTP_INVALID_ITEM");
  const item = parsed.data;
  if (!Number.isFinite(nowMs) || nowMs < 0) throw new OtpError("OTP_INVALID_TIME");

  if (item.otpType === "hotp") {
    const counter = item.counter;
    if (counter === undefined) throw new OtpError("OTP_INVALID_ITEM");
    return {
      code: await generateHotp(item.secret, counter, item.digits, item.algorithm, crypto),
      counter,
    };
  }

  const nowSeconds = Math.floor(nowMs / 1000);
  const counter = Math.floor(nowSeconds / item.period);
  const nextBoundarySeconds = (counter + 1) * item.period;
  const code =
    item.otpType === "steam"
      ? await generateSteamCode(item.secret, counter, crypto)
      : await generateHotp(item.secret, counter, item.digits, item.algorithm, crypto);
  return {
    code,
    counter,
    remaining: nextBoundarySeconds - nowSeconds,
    expiresAt: nextBoundarySeconds * 1000,
  };
}
