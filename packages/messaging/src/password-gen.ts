import { z } from "zod/mini";

import type { CommandSenderPolicy } from "./context";
import { MESSAGE_VERSION } from "./envelope";

export const GeneratePasswordRequestSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("password.generate"),
  mode: z.enum(["random", "passphrase"]),
  length: z.optional(z.int().check(z.minimum(8), z.maximum(128))),
  uppercase: z.optional(z.boolean()),
  lowercase: z.optional(z.boolean()),
  digits: z.optional(z.boolean()),
  symbols: z.optional(z.boolean()),
  excludeAmbiguous: z.optional(z.boolean()),
  wordCount: z.optional(z.int().check(z.minimum(3), z.maximum(10))),
  separator: z.optional(z.enum(["hyphen", "space", "period", "none"])),
  capitalize: z.optional(z.boolean()),
});

export const GeneratePasswordResponseSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("password.generateResult"),
  password: z.string(),
  entropyBits: z.number(),
});

const email = z.string().check(z.maxLength(254));
const domain = z.string().check(z.maxLength(253));

/** A username or address: two words, random letters, a plus-address on the saved e-mail, or a catch-all. */
export const GenerateUsernameRequestSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("password.generateUsername"),
  usernameKind: z.enum(["word", "random", "plus", "catchall"]),
  /** Overrides the saved address or domain for this one call. */
  email: z.optional(email),
  domain: z.optional(domain),
  /** The site the name is for, so a plus-address tag can name it. */
  site: z.optional(z.string().check(z.maxLength(253))),
  length: z.optional(z.int().check(z.minimum(6), z.maximum(32))),
  number: z.optional(z.boolean()),
  capitalize: z.optional(z.boolean()),
});
export const GenerateUsernameResponseSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("password.generateUsernameResult"),
  username: z.string(),
  entropyBits: z.number(),
});
/** The address and domain the username generator builds on; stored, never secret. */
export const GetGeneratorSettingsRequestSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("password.getGeneratorSettings"),
});
export const SetGeneratorSettingsRequestSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("password.setGeneratorSettings"),
  email,
  domain,
});
export const GeneratorSettingsResponseSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("password.generatorSettings"),
  email,
  domain,
});

export const PasswordGenRequestSchema = z.discriminatedUnion("kind", [
  GeneratePasswordRequestSchema,
  GenerateUsernameRequestSchema,
  GetGeneratorSettingsRequestSchema,
  SetGeneratorSettingsRequestSchema,
]);
export const PasswordGenResponseSchema = z.discriminatedUnion("kind", [
  GeneratePasswordResponseSchema,
  GenerateUsernameResponseSchema,
  GeneratorSettingsResponseSchema,
]);

export type GeneratePasswordRequest = z.infer<typeof GeneratePasswordRequestSchema>;
export type GeneratePasswordResponse = z.infer<typeof GeneratePasswordResponseSchema>;
export type GenerateUsernameRequest = z.infer<typeof GenerateUsernameRequestSchema>;
export type GenerateUsernameResponse = z.infer<typeof GenerateUsernameResponseSchema>;
export type PasswordGenRequest = z.infer<typeof PasswordGenRequestSchema>;
export type PasswordGenResponse = z.infer<typeof PasswordGenResponseSchema>;
export type PasswordGenCommandKind = PasswordGenRequest["kind"];

const popupAndVault = { allowedContexts: ["popup", "vault"], requireDocument: true } as const;

export const passwordGenSenderPolicy = {
  "password.generate": popupAndVault,
  "password.generateUsername": popupAndVault,
  "password.getGeneratorSettings": popupAndVault,
  "password.setGeneratorSettings": popupAndVault,
} satisfies Record<PasswordGenCommandKind, CommandSenderPolicy>;

export const passwordGenResponseKindByRequest = {
  "password.generate": "password.generateResult",
  "password.generateUsername": "password.generateUsernameResult",
  "password.getGeneratorSettings": "password.generatorSettings",
  "password.setGeneratorSettings": "password.generatorSettings",
} as const satisfies Record<PasswordGenCommandKind, PasswordGenResponse["kind"]>;
