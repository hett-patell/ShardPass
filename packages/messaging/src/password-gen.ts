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

export type GeneratePasswordRequest = z.infer<typeof GeneratePasswordRequestSchema>;
export type GeneratePasswordResponse = z.infer<typeof GeneratePasswordResponseSchema>;
export type PasswordGenCommandKind = GeneratePasswordRequest["kind"];

const popupAndVault = { allowedContexts: ["popup", "vault"], requireDocument: true } as const;

export const passwordGenSenderPolicy = {
  "password.generate": popupAndVault,
} satisfies Record<PasswordGenCommandKind, CommandSenderPolicy>;
