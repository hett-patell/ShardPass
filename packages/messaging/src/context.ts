import { z } from "zod/mini";

export const senderContextKinds = ["popup", "vault", "content"] as const;

export type SenderContextKind = (typeof senderContextKinds)[number];

const nonemptyStringSchema = z.string().check(z.minLength(1));
const extensionIdSchema = nonemptyStringSchema;
const senderUrlSchema = nonemptyStringSchema;
const browserIdentitySchema = z.int().check(z.nonnegative());
const documentIdSchema = nonemptyStringSchema;

const extensionPageContextSchema = z.strictObject({
  extensionId: extensionIdSchema,
  contextKind: z.enum(["popup", "vault"]),
  senderUrl: senderUrlSchema,
  tabId: z.optional(browserIdentitySchema),
  frameId: z.optional(browserIdentitySchema),
  documentId: z.optional(documentIdSchema),
});

const contentContextSchema = z.strictObject({
  extensionId: extensionIdSchema,
  contextKind: z.literal("content"),
  tabId: browserIdentitySchema,
  frameId: browserIdentitySchema,
  documentId: documentIdSchema,
  senderUrl: senderUrlSchema,
});

export const SenderContextSchema = z.discriminatedUnion("contextKind", [
  extensionPageContextSchema,
  contentContextSchema,
]);

/** Browser-owned metadata normalized by this package before authorization. */
export type SenderContext = z.infer<typeof SenderContextSchema>;

export const RawSenderMetadataSchema = z.strictObject({
  extensionId: extensionIdSchema,
  tabId: z.optional(browserIdentitySchema),
  frameId: z.optional(browserIdentitySchema),
  documentId: z.optional(documentIdSchema),
  senderUrl: senderUrlSchema,
});

export type RawSenderMetadata = z.input<typeof RawSenderMetadataSchema>;

function extensionPageUrl(extensionId: string, contextKind: "popup" | "vault"): string {
  return `chrome-extension://${extensionId}/${contextKind}/index.html`;
}

// Chromium has exposed MessageSender.documentId since M106, but not every Chromium
// browser populates it for extension-page senders — Brave omits it for the popup and
// vault pages, supplying only the extension id and URL. Downstream services bind
// capabilities to this value (KDF challenges, backup authorities, OTP-fill sessions,
// migration credentials), so an absent id would reject every request outright.
//
// Substitute a synthetic per-URL id in that case. Authenticity is unchanged: it still
// rests on the extension id plus an exact extension-page URL match, neither of which a
// web page or another extension can forge. The single concession is that two documents
// sharing one URL (two vault tabs) also share a binding scope rather than being isolated
// from one another. Popup and vault keep separate scopes, as their URLs differ. Where
// the browser does supply a real documentId it is always preferred, so Chromium >= 106
// keeps exact per-document isolation.
function syntheticDocumentId(senderUrl: string): string {
  return `page:${senderUrl}`;
}

function isHttpSenderUrl(senderUrl: string): boolean {
  try {
    const protocol = new URL(senderUrl).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

export function isValidSenderContext(input: unknown): input is SenderContext {
  const parsed = SenderContextSchema.safeParse(input);
  if (!parsed.success) {
    return false;
  }

  const context = parsed.data;
  if (context.contextKind === "content") {
    return isHttpSenderUrl(context.senderUrl);
  }

  return context.senderUrl === extensionPageUrl(context.extensionId, context.contextKind);
}

export function normalizeSenderContext(
  input: unknown,
  expectedExtensionId: string,
): SenderContext | null {
  const parsed = RawSenderMetadataSchema.safeParse(input);
  if (!parsed.success || parsed.data.extensionId !== expectedExtensionId) {
    return null;
  }

  const metadata = parsed.data;
  for (const contextKind of ["popup", "vault"] as const) {
    if (metadata.senderUrl === extensionPageUrl(expectedExtensionId, contextKind)) {
      return {
        extensionId: expectedExtensionId,
        contextKind,
        senderUrl: metadata.senderUrl,
        documentId: metadata.documentId ?? syntheticDocumentId(metadata.senderUrl),
        ...(metadata.tabId === undefined ? {} : { tabId: metadata.tabId }),
        ...(metadata.frameId === undefined ? {} : { frameId: metadata.frameId }),
      };
    }
  }

  if (
    !isHttpSenderUrl(metadata.senderUrl) ||
    metadata.tabId === undefined ||
    metadata.frameId === undefined ||
    metadata.documentId === undefined
  ) {
    return null;
  }

  return {
    extensionId: expectedExtensionId,
    contextKind: "content",
    tabId: metadata.tabId,
    frameId: metadata.frameId,
    documentId: metadata.documentId,
    senderUrl: metadata.senderUrl,
  };
}

export type SenderPolicy = Readonly<{
  extensionId: string;
  allowedContexts: readonly SenderContextKind[];
  requireTab?: boolean;
  requireFrame?: boolean;
  requireDocument?: boolean;
}>;

export type CommandSenderPolicy = Omit<SenderPolicy, "extensionId">;
