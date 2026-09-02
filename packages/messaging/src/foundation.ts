import { z } from "zod/mini";

import { MESSAGE_VERSION, MessageEnvelopeSchema } from "./envelope";

export const FoundationRequestSchema = z.extend(MessageEnvelopeSchema, {
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("foundation.getStatus"),
});

export type FoundationRequest = z.infer<typeof FoundationRequestSchema>;

export const FoundationResponseSchema = z.extend(MessageEnvelopeSchema, {
  version: z.literal(MESSAGE_VERSION),
  kind: z.literal("foundation.status"),
  phase: z.literal("foundation"),
  vaultAvailable: z.literal(false),
});

export type FoundationResponse = z.infer<typeof FoundationResponseSchema>;

export { MessageEnvelopeSchema } from "./envelope";
export type { MessageEnvelope } from "./envelope";
