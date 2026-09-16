import { z } from "zod/mini";

import type { CommandSenderPolicy } from "./context";
import { MESSAGE_VERSION } from "./envelope";

const version = z.literal(MESSAGE_VERSION);

/**
 * E-mail aliases from a forwarding service. DuckDuckGo Email Protection hands out one
 * private @duck.com address per call, forwarded to the person's real inbox, in exchange for
 * the bearer token its own autofill settings page uses. The token is kept sealed under the
 * vault key and only ever sent to DuckDuckGo, from the background.
 */
export const AliasRequestSchema = z.discriminatedUnion("kind", [
  z.strictObject({ version, kind: z.literal("alias.getStatus") }),
  z.strictObject({
    version,
    kind: z.literal("alias.setDuckToken"),
    token: z.string().check(z.minLength(1), z.maxLength(4096)),
  }),
  z.strictObject({ version, kind: z.literal("alias.clearDuckToken") }),
  z.strictObject({ version, kind: z.literal("alias.generateDuck") }),
]);

export const AliasStatusResponseSchema = z.strictObject({
  version,
  kind: z.literal("alias.status"),
  /** A DuckDuckGo token is stored. */
  duckduckgo: z.boolean(),
});

export const AliasGeneratedResponseSchema = z.strictObject({
  version,
  kind: z.literal("alias.generated"),
  provider: z.literal("duckduckgo"),
  address: z.string().check(z.minLength(3), z.maxLength(320)),
});

export const AliasResponseSchema = z.discriminatedUnion("kind", [
  AliasStatusResponseSchema,
  AliasGeneratedResponseSchema,
]);

export type AliasRequest = z.infer<typeof AliasRequestSchema>;
export type AliasResponse = z.infer<typeof AliasResponseSchema>;
export type AliasCommandKind = AliasRequest["kind"];

const vaultOnly = { allowedContexts: ["vault"], requireDocument: true } as const;
const popupAndVault = { allowedContexts: ["popup", "vault"], requireDocument: true } as const;

export const aliasSenderPolicy = {
  "alias.getStatus": popupAndVault,
  "alias.setDuckToken": vaultOnly,
  "alias.clearDuckToken": vaultOnly,
  "alias.generateDuck": popupAndVault,
} satisfies Record<AliasCommandKind, CommandSenderPolicy>;

const responseKindByRequest = {
  "alias.getStatus": "alias.status",
  "alias.setDuckToken": "alias.status",
  "alias.clearDuckToken": "alias.status",
  "alias.generateDuck": "alias.generated",
} as const satisfies Record<AliasCommandKind, AliasResponse["kind"]>;

export function parseAliasResponseForRequest(
  request: AliasRequest,
  candidate: unknown,
): Readonly<{ success: true; data: AliasResponse }> | Readonly<{ success: false }> {
  const parsed = AliasResponseSchema.safeParse(candidate);
  if (!parsed.success || parsed.data.kind !== responseKindByRequest[request.kind])
    return { success: false };
  return { success: true, data: parsed.data };
}
