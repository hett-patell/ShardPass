import { isValidSenderContext } from "./context";
import type { CommandSenderPolicy, SenderPolicy } from "./context";
import type { FoundationRequest } from "./foundation";

export type FoundationCommandKind = FoundationRequest["kind"];

export const foundationSenderPolicy = {
  "foundation.getStatus": {
    allowedContexts: ["popup", "vault"],
    requireTab: false,
    requireFrame: false,
    requireDocument: false,
  },
} as const satisfies Readonly<Record<FoundationCommandKind, CommandSenderPolicy>>;

function isNonNegativeInteger(value: number | undefined): value is number {
  return value !== undefined && Number.isInteger(value) && value >= 0;
}

export function authorizeSender(context: unknown, policy: SenderPolicy): boolean {
  if (!isValidSenderContext(context) || context.extensionId !== policy.extensionId) {
    return false;
  }

  if (!policy.allowedContexts.includes(context.contextKind)) {
    return false;
  }

  if (
    context.contextKind !== "content" &&
    (policy.requireTab === true || policy.requireFrame === true)
  ) {
    return false;
  }

  if (
    (policy.requireDocument === true && !context.documentId) ||
    (context.contextKind === "content" &&
      ((policy.requireTab === true && !isNonNegativeInteger(context.tabId)) ||
        (policy.requireFrame === true && !isNonNegativeInteger(context.frameId))))
  ) {
    return false;
  }

  return true;
}
