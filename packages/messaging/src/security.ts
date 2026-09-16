import { z } from "zod/mini";

import type { CommandSenderPolicy } from "./context";
import { MESSAGE_VERSION } from "./envelope";

const version = z.literal(MESSAGE_VERSION);
const itemId = z.uuid();

/**
 * Breach checks against Have I Been Pwned, with k-anonymity: only the first five characters
 * of the password's SHA-1 ever leave the device, and the reply is padded so its size says
 * nothing. Off until the person turns it on, since a local-first vault makes no network
 * call it was not asked for.
 */
export const SecurityRequestSchema = z.discriminatedUnion("kind", [
  z.strictObject({ version, kind: z.literal("security.getSettings") }),
  z.strictObject({ version, kind: z.literal("security.setBreachChecks"), enabled: z.boolean() }),
  z.strictObject({
    version,
    kind: z.literal("security.checkItem"),
    itemId,
    /** Ask Have I Been Pwned again even when a result for this password is remembered. */
    force: z.optional(z.boolean()),
  }),
  /** Remembered results: every checked login, or one, with whether its password changed since. */
  z.strictObject({ version, kind: z.literal("security.listResults"), itemId: z.optional(itemId) }),
]);

export const SecuritySettingsResponseSchema = z.strictObject({
  version,
  kind: z.literal("security.settings"),
  breachChecks: z.boolean(),
});

export const BreachResultResponseSchema = z.strictObject({
  version,
  kind: z.literal("security.breachResult"),
  itemId,
  /** How many times the password appears in known breaches; 0 means not found. */
  count: z.int().check(z.nonnegative()),
  checkedAt: z.int().check(z.nonnegative()),
});

export const BreachResultsListResponseSchema = z.strictObject({
  version,
  kind: z.literal("security.results"),
  results: z.array(
    z.strictObject({
      itemId,
      count: z.int().check(z.nonnegative()),
      checkedAt: z.int().check(z.nonnegative()),
      /** The password changed after this check; the count no longer describes it. */
      stale: z.boolean(),
    }),
  ),
});

export const SecurityResponseSchema = z.discriminatedUnion("kind", [
  SecuritySettingsResponseSchema,
  BreachResultResponseSchema,
  BreachResultsListResponseSchema,
]);

export type SecurityRequest = z.infer<typeof SecurityRequestSchema>;
export type SecurityResponse = z.infer<typeof SecurityResponseSchema>;
export type SecurityCommandKind = SecurityRequest["kind"];

const vaultOnly = { allowedContexts: ["vault"], requireDocument: true } as const;
const popupAndVault = { allowedContexts: ["popup", "vault"], requireDocument: true } as const;

export const securitySenderPolicy = {
  "security.getSettings": popupAndVault,
  "security.setBreachChecks": vaultOnly,
  "security.checkItem": vaultOnly,
  "security.listResults": popupAndVault,
} satisfies Record<SecurityCommandKind, CommandSenderPolicy>;

const responseKindByRequest = {
  "security.getSettings": "security.settings",
  "security.setBreachChecks": "security.settings",
  "security.checkItem": "security.breachResult",
  "security.listResults": "security.results",
} as const satisfies Record<SecurityCommandKind, SecurityResponse["kind"]>;

export function parseSecurityResponseForRequest(
  request: SecurityRequest,
  candidate: unknown,
): Readonly<{ success: true; data: SecurityResponse }> | Readonly<{ success: false }> {
  const parsed = SecurityResponseSchema.safeParse(candidate);
  if (!parsed.success || parsed.data.kind !== responseKindByRequest[request.kind])
    return { success: false };
  return { success: true, data: parsed.data };
}
