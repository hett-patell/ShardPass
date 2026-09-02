import { canonicalJson } from "@shardpass/storage";

import type { EnteOtpProjection } from "./protocol";

export type EnteMergeAction =
  | "take-remote"
  | "push-local"
  | "converged"
  | "conflict"
  | "delete"
  | "noop"
  | "add-local"
  | "add-remote";
export type EnteMergePlan = Readonly<{
  action: EnteMergeAction;
  local?: EnteOtpProjection | null;
  remote?: EnteOtpProjection | null;
}>;
const equal = (left: EnteOtpProjection | null, right: EnteOtpProjection | null) =>
  canonicalJson(left) === canonicalJson(right);
export function mergeEnteOtp(input: {
  readonly base: EnteOtpProjection | null;
  readonly local: EnteOtpProjection | null;
  readonly remote: EnteOtpProjection | null;
}): EnteMergePlan {
  const { base, local, remote } = input;
  if (base === null) {
    if (local === null && remote === null) return { action: "noop" };
    if (local !== null && remote === null) return { action: "add-local", local };
    if (local === null && remote !== null) return { action: "add-remote", remote };
    return equal(local, remote)
      ? { action: "converged", local, remote }
      : { action: "conflict", local, remote };
  }
  if (equal(local, remote))
    return local === null ? { action: "delete" } : { action: "converged", local, remote };
  if (equal(local, base)) return { action: "take-remote", remote };
  if (equal(remote, base)) return { action: "push-local", local };
  return { action: "conflict", local, remote };
}
