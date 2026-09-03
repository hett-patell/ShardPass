import type { EnteClient } from "./client";
import { EnteProtocolError } from "./protocol";

export type PasswordJobResult = Readonly<{
  srpUserId: string;
  clientPublicA: string;
  prove(serverPublicB: string): Readonly<{
    clientM1: string;
    verifyM2(serverM2: string): void;
    recoverCredential(
      response: unknown,
    ): Promise<{ token: string; reusableCredentialEnvelope: string }>;
  }>;
  dispose(): void;
}>;
export type EntePasswordJob = Readonly<{
  run(attributes: unknown, email: string, signal: AbortSignal): Promise<PasswordJobResult>;
  dispose(): void;
}>;
export type EnteAuthChallenge = Readonly<{
  capability: string;
  expiresAt: number;
  sessionId: string;
  credentialEnvelope: string;
  maskedEmail: string;
}>;
export class EnteAuthChallengeStore {
  private readonly values = new Map<string, EnteAuthChallenge>();
  constructor(
    private readonly now: () => number,
    private readonly random: () => string,
  ) {}
  issue(input: Omit<EnteAuthChallenge, "capability" | "expiresAt">): EnteAuthChallenge {
    const value = { ...input, capability: this.random(), expiresAt: this.now() + 5 * 60_000 };
    this.values.set(value.capability, value);
    return value;
  }
  consume(capability: string): EnteAuthChallenge {
    const value = this.values.get(capability);
    this.values.delete(capability);
    if (!value || value.expiresAt < this.now()) throw new EnteProtocolError("ENTE_AUTH_FAILED");
    return value;
  }
  clear(): void {
    this.values.clear();
  }
}
const mask = (email: string) => {
  const [name = "", domain = ""] = email.split("@");
  return `${name.slice(0, 1)}***@${domain}`;
};
export async function authenticateEnte(input: {
  readonly client: EnteClient;
  readonly email: string;
  readonly passwordJob: EntePasswordJob;
  readonly totpCode?: string;
  readonly challenge?: EnteAuthChallenge;
  readonly challenges: EnteAuthChallengeStore;
  readonly signal: AbortSignal;
}): Promise<
  | { status: "totp-required"; challengeCapability: string; maskedEmail: string }
  | {
      status: "authenticated";
      reusableCredentialEnvelope: string;
      token: string;
      maskedEmail: string;
    }
> {
  if (input.totpCode !== undefined) {
    if (!input.challenge || !/^\d{6,10}$/u.test(input.totpCode))
      throw new EnteProtocolError("ENTE_AUTH_FAILED");
    const response = (await input.client.verifyTotp2fa(
      { code: input.totpCode, sessionID: input.challenge.sessionId },
      input.signal,
    )) as { encryptedToken: string };
    return {
      status: "authenticated",
      reusableCredentialEnvelope: input.challenge.credentialEnvelope,
      token: response.encryptedToken,
      maskedEmail: input.challenge.maskedEmail,
    };
  }
  let job: PasswordJobResult | undefined;
  try {
    const attributes = await input.client.getSrpAttributes(input.email, input.signal);
    job = await input.passwordJob.run(attributes, input.email, input.signal);
    const session = (await input.client.createSrpSession(
      { srpUserID: job.srpUserId, srpA: job.clientPublicA },
      input.signal,
    )) as { sessionID: string; srpB: string };
    const proof = job.prove(session.srpB);
    const verified = (await input.client.verifySrpSession(
      { sessionID: session.sessionID, srpUserID: job.srpUserId, srpM1: proof.clientM1 },
      input.signal,
    )) as {
      srpM2: string;
      token?: string;
      encryptedToken?: string;
      twoFactorSessionID?: string;
      twoFactorSessionIDV2?: string;
      passkeySessionID?: string;
    };
    proof.verifyM2(verified.srpM2);
    const recovered = await proof.recoverCredential(verified);
    const twoFactorSessionId = verified.twoFactorSessionID ?? verified.twoFactorSessionIDV2;
    if (twoFactorSessionId !== undefined) {
      const challenge = input.challenges.issue({
        sessionId: twoFactorSessionId,
        credentialEnvelope: recovered.reusableCredentialEnvelope,
        maskedEmail: mask(input.email),
      });
      return {
        status: "totp-required",
        challengeCapability: challenge.capability,
        maskedEmail: challenge.maskedEmail,
      };
    }
    if (!recovered.token) throw new EnteProtocolError("ENTE_AUTH_FAILED");
    return {
      status: "authenticated",
      reusableCredentialEnvelope: recovered.reusableCredentialEnvelope,
      token: recovered.token,
      maskedEmail: mask(input.email),
    };
  } catch (error) {
    if (error instanceof EnteProtocolError) throw error;
    throw new EnteProtocolError("ENTE_AUTH_FAILED");
  } finally {
    job?.dispose();
    input.passwordJob.dispose();
  }
}
export async function retrieveExistingAuthenticatorKey(
  client: EnteClient,
  token: string,
  signal: AbortSignal,
): Promise<unknown> {
  try {
    return await client.getAuthenticatorKey(token, signal);
  } catch (error) {
    if (error instanceof EnteProtocolError && error.code === "ENTE_AUTH_KEY_MISSING") throw error;
    if (error instanceof EnteProtocolError && error.code === "ENTE_AUTH_FAILED")
      throw new EnteProtocolError("ENTE_SRP_UNSUPPORTED");
    throw error;
  }
}
