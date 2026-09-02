import type { EnteOtpProjection } from "./protocol";
import { EnteProtocolError } from "./protocol";
import { mergeEnteOtp, type EnteMergePlan } from "./merge";

export type EnteConflictBinding = Readonly<{
  expiresAt: number;
  sessionEpoch: number;
  rootDigest: string;
  conflictId: string;
  baseDigest: string;
  localDigest: string;
  remoteDigest: string;
  base: EnteOtpProjection | null;
  local: EnteOtpProjection | null;
  remote: EnteOtpProjection | null;
  sender?: string;
}>;
export class EnteConflictCapabilities {
  private readonly values = new Map<string, EnteConflictBinding>();
  constructor(
    private readonly now: () => number,
    private readonly random: () => string,
  ) {}
  issue(binding: Omit<EnteConflictBinding, "expiresAt">, ttlMs = 5 * 60_000): string {
    const capability = this.random();
    this.values.set(capability, { ...binding, expiresAt: this.now() + ttlMs });
    return capability;
  }
  take(input: {
    capability: string;
    sessionEpoch: number;
    currentRootDigest: string;
  }): EnteConflictBinding {
    const binding = this.values.get(input.capability);
    this.values.delete(input.capability);
    if (
      !binding ||
      binding.expiresAt < this.now() ||
      binding.sessionEpoch !== input.sessionEpoch ||
      binding.rootDigest !== input.currentRootDigest
    )
      throw new EnteProtocolError("ENTE_CONFLICT");
    return binding;
  }
  resolve(input: {
    capability: string;
    choice: "keep-local" | "keep-ente" | "keep-both";
    sessionEpoch: number;
    currentRootDigest: string;
    currentConflictId: string;
    currentDigests: { base: string; local: string; remote: string };
  }): EnteMergePlan {
    const binding = this.values.get(input.capability);
    this.values.delete(input.capability);
    if (
      !binding ||
      binding.expiresAt < this.now() ||
      binding.sessionEpoch !== input.sessionEpoch ||
      binding.rootDigest !== input.currentRootDigest ||
      binding.conflictId !== input.currentConflictId ||
      binding.baseDigest !== input.currentDigests.base ||
      binding.localDigest !== input.currentDigests.local ||
      binding.remoteDigest !== input.currentDigests.remote
    )
      throw new EnteProtocolError("ENTE_CONFLICT");
    if (input.choice === "keep-local") return { action: "push-local", local: binding.local };
    if (input.choice === "keep-ente") return { action: "take-remote", remote: binding.remote };
    if (binding.local === null || binding.remote === null)
      throw new EnteProtocolError("ENTE_CONFLICT");
    return mergeEnteOtp({ base: null, local: binding.local, remote: binding.remote });
  }
  clear(): void {
    this.values.clear();
  }
}
