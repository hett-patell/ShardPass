import "@testing-library/jest-dom/vitest";

import type { ParsedOtpImport } from "@shardpass/importers";
import type { OtpImportRequest, OtpImportResponse } from "@shardpass/messaging";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { OtpImportUiExtensionPlatform } from "../../src/platform/extension-platform";
import { OtpImportView } from "../../src/vault/otp/import/OtpImportView";

const previewToken = "10000000-0000-4000-8000-000000000020";
const rowToken = "10000000-0000-4000-8000-000000000021";
const candidate = Object.freeze({
  sourceOrdinal: 1,
  issuer: "Example issuer",
  label: "Example account",
  secret: "JBSWY3DPEHPK3PXP",
  otpType: "totp" as const,
  algorithm: "SHA1" as const,
  digits: 6,
  period: 30,
  favorite: false,
  tags: Object.freeze(["private metadata"]),
  note: "private note",
});
const parsed: ParsedOtpImport = Object.freeze({
  format: "otpauth",
  candidates: Object.freeze([candidate]),
  rejected: Object.freeze([]),
});
const preview = {
  version: 1,
  kind: "otp.importPreviewResult",
  previewToken,
  format: "otpauth",
  rows: [
    {
      rowId: rowToken,
      ordinal: 1,
      status: "accepted",
      reason: "IMPORT_ACCEPTED",
      metadata: {
        issuer: candidate.issuer,
        label: candidate.label,
        otpType: candidate.otpType,
        algorithm: candidate.algorithm,
        digits: candidate.digits,
        period: candidate.period,
      },
    },
  ],
  accepted: 1,
  duplicate: 0,
  rejected: 0,
  expiresAt: Date.now() + 300_000,
} satisfies OtpImportResponse;

function platform(responder: (request: OtpImportRequest) => Promise<OtpImportResponse>) {
  const snapshots: OtpImportRequest[] = [];
  const sendOtpImportMessage = vi.fn((request: OtpImportRequest) => {
    snapshots.push(structuredClone(request));
    return responder(request);
  });
  const value: OtpImportUiExtensionPlatform = {
    extensionId: "vault-test-id",
    onMessage: () => () => undefined,
    sendMessage: () => Promise.resolve(undefined),
    sendOtpImportMessage,
    openVaultPage: () => Promise.resolve(),
  };
  return { value, sendOtpImportMessage, snapshots };
}

const parser = vi.fn((text: string, signal: AbortSignal) => {
  void text;
  void signal;
  return Promise.resolve(parsed);
});
const imageExecutor = {
  decode: vi.fn((file: Blob, signal: AbortSignal) => {
    void file;
    void signal;
    return Promise.resolve("bounded decoded text");
  }),
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("OtpImportView", () => {
  it("keeps sensitive input local, concealed, hardened, and clears it before safe preview", async () => {
    let resolvePreview!: (value: OtpImportResponse) => void;
    const pending = new Promise<OtpImportResponse>((resolve) => (resolvePreview = resolve));
    const { value, sendOtpImportMessage, snapshots } = platform(() => pending);
    const { container } = render(
      <OtpImportView
        platform={value}
        active
        onImported={vi.fn()}
        parseText={parser}
        imageExecutor={imageExecutor}
      />,
    );

    const input = screen.getByLabelText("Sensitive import input");
    expect(input).toHaveAttribute("autocomplete", "off");
    expect(input).toHaveAttribute("spellcheck", "false");
    expect(input).toHaveAttribute("autocapitalize", "none");
    expect(input).toHaveAttribute("data-concealed", "true");
    fireEvent.change(input, { target: { value: "bounded local input" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview import" }));

    await waitFor(() => expect(sendOtpImportMessage).toHaveBeenCalledTimes(1));
    expect(input).toHaveValue("");
    expect(snapshots).toContainEqual({
      version: 1,
      kind: "otp.importPreview",
      format: "otpauth",
      candidates: [{ ...candidate, tags: [...candidate.tags] }],
    });
    expect(sendOtpImportMessage.mock.calls[0]?.[0]).toMatchObject({ candidates: [] });
    expect(container.innerHTML).not.toContain(candidate.secret);
    expect(container.innerHTML).not.toContain(candidate.note);
    expect(container.innerHTML).not.toContain(candidate.tags[0]);

    resolvePreview(preview);
    expect(await screen.findByText("Example issuer")).toBeVisible();
    expect(screen.getByText("Example account")).toBeVisible();
    expect(container.innerHTML).not.toContain(candidate.secret);
    expect(container.innerHTML).not.toContain(candidate.note);
    expect(container.innerHTML).not.toContain(candidate.tags[0]);
    expect(screen.getByText("1", { selector: "strong" })).toBeVisible();
  });

  it("clears raw controls synchronously before a deferred parser settles", () => {
    const deferredParser = vi.fn(() => new Promise<ParsedOtpImport>(() => undefined));
    const { value } = platform(() => Promise.resolve(preview));
    render(
      <OtpImportView
        platform={value}
        active
        onImported={vi.fn()}
        parseText={deferredParser}
        imageExecutor={imageExecutor}
      />,
    );
    const input = screen.getByLabelText("Sensitive import input");
    fireEvent.change(input, { target: { value: "bounded local input" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview import" }));
    expect(input).toHaveValue("");
    expect(deferredParser).toHaveBeenCalledTimes(1);
  });

  it("maps synchronous parser failures to a fixed UI error", async () => {
    const failingParser = vi.fn(() => {
      throw new Error("IMPORT_UNSUPPORTED");
    });
    const { value } = platform(() => Promise.resolve(preview));
    render(
      <OtpImportView
        platform={value}
        active
        onImported={vi.fn()}
        parseText={failingParser}
        imageExecutor={imageExecutor}
      />,
    );
    fireEvent.change(screen.getByLabelText("Sensitive import input"), {
      target: { value: "bounded local input" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview import" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Import could not be read safely");
  });

  it("merges parser rejections into safe counts without projecting rejected input", async () => {
    const rejectedParser = vi.fn(() =>
      Promise.resolve(
        Object.freeze({
          ...parsed,
          rejected: Object.freeze([
            Object.freeze({ ordinal: 2, reason: "IMPORT_UNSUPPORTED" as const }),
          ]),
        }),
      ),
    );
    const { value } = platform(() => Promise.resolve(preview));
    const { container } = render(
      <OtpImportView
        platform={value}
        active
        onImported={vi.fn()}
        parseText={rejectedParser}
        imageExecutor={imageExecutor}
      />,
    );
    fireEvent.change(screen.getByLabelText("Sensitive import input"), {
      target: { value: "bounded local input" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview import" }));

    const summary = await screen.findByLabelText("Import summary");
    expect(within(summary).getByText("REJECTED").parentElement).toHaveTextContent("1");
    expect(screen.getByText("Unsupported entry")).toBeVisible();
    expect(container.innerHTML).not.toContain("bounded local input");
  });

  it.each([
    [
      "candidate collision",
      Object.freeze({
        ...parsed,
        candidates: Object.freeze([candidate, Object.freeze({ ...candidate, label: "Second" })]),
      }),
    ],
    [
      "candidate and rejected collision",
      Object.freeze({
        ...parsed,
        rejected: Object.freeze([
          Object.freeze({ ordinal: 1, reason: "IMPORT_UNSUPPORTED" as const }),
        ]),
      }),
    ],
  ])("rejects %s before transport or merge", async (_label, collided) => {
    const collidedParser = vi.fn(() => Promise.resolve(collided));
    const { value, sendOtpImportMessage } = platform(() => Promise.resolve(preview));
    render(
      <OtpImportView
        platform={value}
        active
        onImported={vi.fn()}
        parseText={collidedParser}
        imageExecutor={imageExecutor}
      />,
    );
    fireEvent.change(screen.getByLabelText("Sensitive import input"), {
      target: { value: "bounded local input" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview import" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Import could not be read safely");
    expect(sendOtpImportMessage).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Import summary")).not.toBeInTheDocument();
  });

  it("shows an all-rejected local preview without transport or confirmation", async () => {
    const rejectedParser = vi.fn(() =>
      Promise.resolve(
        Object.freeze({
          format: "otpauth" as const,
          candidates: Object.freeze([]),
          rejected: Object.freeze([
            Object.freeze({ ordinal: 1, reason: "IMPORT_MALFORMED" as const }),
          ]),
        }),
      ),
    );
    const { value, sendOtpImportMessage } = platform(() => Promise.resolve(preview));
    render(
      <OtpImportView
        platform={value}
        active
        onImported={vi.fn()}
        parseText={rejectedParser}
        imageExecutor={imageExecutor}
      />,
    );
    fireEvent.change(screen.getByLabelText("Sensitive import input"), {
      target: { value: "bounded local input" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview import" }));
    expect(await screen.findByText("Malformed entry")).toBeVisible();
    expect(sendOtpImportMessage).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Confirm import" })).toBeDisabled();
  });

  it("orders interleaved accepted and rejected rows by source ordinal", async () => {
    const secondCandidate = Object.freeze({ ...candidate, sourceOrdinal: 3, label: "Third" });
    const interleavedParser = vi.fn(() =>
      Promise.resolve(
        Object.freeze({
          format: "otpauth" as const,
          candidates: Object.freeze([candidate, secondCandidate]),
          rejected: Object.freeze([
            Object.freeze({ ordinal: 2, reason: "IMPORT_UNSUPPORTED" as const }),
          ]),
        }),
      ),
    );
    const interleavedPreview: OtpImportResponse = {
      ...preview,
      rows: [
        {
          rowId: rowToken,
          ordinal: 1,
          status: "accepted",
          reason: "IMPORT_ACCEPTED",
          metadata: {
            issuer: "Example issuer",
            label: "Example account",
            otpType: "totp",
            algorithm: "SHA1",
            digits: 6,
            period: 30,
          },
        },
        {
          rowId: "20000000-0000-4000-8000-000000000021",
          ordinal: 3,
          status: "accepted",
          reason: "IMPORT_ACCEPTED",
          metadata: {
            issuer: "Example issuer",
            label: "Third",
            otpType: "totp",
            algorithm: "SHA1",
            digits: 6,
            period: 30,
          },
        },
      ],
      accepted: 2,
    };
    const { value } = platform(() => Promise.resolve(interleavedPreview));
    render(
      <OtpImportView
        platform={value}
        active
        onImported={vi.fn()}
        parseText={interleavedParser}
        imageExecutor={imageExecutor}
      />,
    );
    fireEvent.change(screen.getByLabelText("Sensitive import input"), {
      target: { value: "bounded local input" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview import" }));
    const rows = await screen.findAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("Example account"),
      expect.stringContaining("Unsupported entry"),
      expect.stringContaining("Third"),
    ]);
  });

  it("requires explicit review, confirms with only the token, and reports a fixed imported count", async () => {
    const onImported = vi.fn();
    const { value, sendOtpImportMessage } = platform((request) => {
      if (request.kind === "otp.importPreview") return Promise.resolve(preview);
      if (request.kind === "otp.importConfirm")
        return Promise.resolve({
          version: 1,
          kind: "otp.importConfirmed",
          imported: 1,
          duplicate: 0,
        });
      return Promise.resolve({ version: 1, kind: "otp.importCancelled", cancelled: true });
    });
    render(
      <OtpImportView
        platform={value}
        active
        onImported={onImported}
        parseText={parser}
        imageExecutor={imageExecutor}
      />,
    );
    fireEvent.change(screen.getByLabelText("Sensitive import input"), {
      target: { value: "bounded local input" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview import" }));
    await screen.findByText("Example account");

    const confirm = screen.getByRole("button", { name: "Confirm import" });
    expect(confirm).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "I reviewed the import summary" }));
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(sendOtpImportMessage).toHaveBeenLastCalledWith({
        version: 1,
        kind: "otp.importConfirm",
        previewToken,
      }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("1 OTP item imported");
    expect(onImported).toHaveBeenCalledTimes(1);
  });

  it("replaces a changed preview and requires a second explicit review", async () => {
    const changed = {
      ...preview,
      kind: "otp.importPreviewChanged" as const,
      accepted: 0,
      duplicate: 1,
    };
    const { value } = platform((request) =>
      request.kind === "otp.importPreview" ? Promise.resolve(preview) : Promise.resolve(changed),
    );
    render(
      <OtpImportView
        platform={value}
        active
        onImported={vi.fn()}
        parseText={parser}
        imageExecutor={imageExecutor}
      />,
    );
    fireEvent.change(screen.getByLabelText("Sensitive import input"), {
      target: { value: "bounded local input" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview import" }));
    await screen.findByText("Example account");
    fireEvent.click(screen.getByRole("checkbox", { name: "I reviewed the import summary" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm import" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Import summary changed");
    expect(
      screen.getByRole("checkbox", { name: "I reviewed the import summary" }),
    ).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Confirm import" })).toBeDisabled();
  });

  it("cancels by token, clears immediately, ignores late results, and restores focus", async () => {
    let resolvePreview!: (value: OtpImportResponse) => void;
    const { value, sendOtpImportMessage } = platform(
      () => new Promise((resolve) => (resolvePreview = resolve)),
    );
    render(
      <OtpImportView
        platform={value}
        active
        onImported={vi.fn()}
        parseText={parser}
        imageExecutor={imageExecutor}
      />,
    );
    const input = screen.getByLabelText("Sensitive import input");
    fireEvent.change(input, { target: { value: "bounded local input" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview import" }));
    await waitFor(() => expect(sendOtpImportMessage).toHaveBeenCalled());
    fireEvent.keyDown(screen.getByRole("region", { name: "Import OTP items" }), { key: "Escape" });
    expect(input).toHaveValue("");
    resolvePreview(preview);
    await Promise.resolve();
    expect(screen.queryByText("Example account")).not.toBeInTheDocument();
    expect(input).toHaveFocus();
  });

  it("accepts only bounded PNG files and supports keyboard-accessible drop", async () => {
    const { value } = platform(() => Promise.resolve(preview));
    render(
      <OtpImportView
        platform={value}
        active
        onImported={vi.fn()}
        parseText={parser}
        imageExecutor={imageExecutor}
      />,
    );
    const chooser = screen.getByLabelText("Choose a local PNG image");
    const wrong = new File([new Uint8Array([1])], "private-name.jpg", { type: "image/jpeg" });
    fireEvent.change(chooser, { target: { files: [wrong] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("Choose a PNG image");
    expect(imageExecutor.decode).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain(wrong.name);

    const tooLarge = new File([new Uint8Array(8_388_609)], "private-name.png", {
      type: "image/png",
    });
    fireEvent.drop(screen.getByRole("button", { name: "Drop PNG image here" }), {
      dataTransfer: { files: [tooLarge] },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("Image is too large");
    expect(imageExecutor.decode).not.toHaveBeenCalled();
  });

  it("renders at most a bounded virtual window for a 1,000-row safe preview", async () => {
    const rows: Extract<OtpImportResponse, { kind: "otp.importPreviewResult" }>["rows"] =
      Array.from({ length: 1_000 }, (_, index) => ({
        rowId: `${String(index).padStart(8, "a")}-0000-4000-8000-000000000021`,
        ordinal: index + 1,
        status: "accepted",
        reason: "IMPORT_ACCEPTED",
        metadata: {
          issuer: `Issuer ${index + 1}`,
          label: "Example account",
          otpType: "totp",
          algorithm: "SHA1",
          digits: 6,
          period: 30,
        },
      }));
    const largePreview = { ...preview, rows, accepted: 1_000 };
    const { value } = platform(() => Promise.resolve(largePreview));
    render(
      <OtpImportView
        platform={value}
        active
        onImported={vi.fn()}
        parseText={parser}
        imageExecutor={imageExecutor}
      />,
    );
    fireEvent.change(screen.getByLabelText("Sensitive import input"), {
      target: { value: "bounded local input" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview import" }));
    const list = await screen.findByRole("list", { name: "Safe import preview rows" });
    expect(within(list).getAllByRole("listitem").length).toBeLessThanOrEqual(50);
  });

  it("unmounts while inactive and has no serious axe violations", async () => {
    const { value } = platform(() => Promise.resolve(preview));
    const { container, rerender } = render(
      <OtpImportView
        platform={value}
        active
        onImported={vi.fn()}
        parseText={parser}
        imageExecutor={imageExecutor}
      />,
    );
    expect(screen.queryByText(/camera|remote URL|backup|sync/i)).not.toBeInTheDocument();
    const results = await axe.run(container, {
      resultTypes: ["violations"],
      rules: { "color-contrast": { enabled: false } },
    });
    expect(
      results.violations.filter(({ impact }) => impact === "serious" || impact === "critical"),
    ).toEqual([]);
    rerender(
      <OtpImportView
        platform={value}
        active={false}
        onImported={vi.fn()}
        parseText={parser}
        imageExecutor={imageExecutor}
      />,
    );
    expect(screen.queryByRole("region", { name: "Import OTP items" })).not.toBeInTheDocument();
  });
});
