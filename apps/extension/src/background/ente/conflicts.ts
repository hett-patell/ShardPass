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
const MAX_CONFLICT_CAPABILITIES = 256;

export class EnteConflictCapabilities {
  private readonly values = new Map<string, EnteConflictBinding>();
  constructor(
    private readonly now: () => number,
    private readonly random: () => string,
  ) {}
  issue(binding: Omit<EnteConflictBinding, "expiresAt">, ttlMs = 5 * 60_000): string {
    const now = this.now();
    // Expired bindings hold plaintext projections; they go as soon as anything happens here.
    for (const [key, value] of this.values) if (value.expiresAt < now) this.values.delete(key);
    // The panel asks every few seconds: the same conflict for the same sender keeps its
    // capability (renewed), rather than a fresh copy of its secrets per poll.
    for (const [key, value] of this.values) {
      if (
        value.conflictId === binding.conflictId &&
        value.sender === binding.sender &&
        value.sessionEpoch === binding.sessionEpoch &&
        value.rootDigest === binding.rootDigest &&
        value.baseDigest === binding.baseDigest &&
        value.localDigest === binding.localDigest &&
        value.remoteDigest === binding.remoteDigest
      ) {
        this.values.set(key, { ...value, expiresAt: now + ttlMs });
        return key;
      }
    }
    while (this.values.size >= MAX_CONFLICT_CAPABILITIES) {
      const oldest = this.values.keys().next().value;
      if (oldest === undefined) break;
      this.values.delete(oldest);
    }
    const capability = this.random();
    this.values.set(capability, { ...binding, expiresAt: now + ttlMs });
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
