import { z } from "zod/mini";

export const MESSAGE_VERSION = 1 as const;

export const MessageEnvelopeSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  kind: z.string().check(z.minLength(1)),
});

export type MessageEnvelope = z.infer<typeof MessageEnvelopeSchema>;
