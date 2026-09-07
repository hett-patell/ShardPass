import "@testing-library/jest-dom/vitest";

import type { ItemCrudRequest } from "@shardpass/messaging";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  BackupUiExtensionPlatform,
  ExtensionPlatform,
  OtpImportUiExtensionPlatform,
} from "../../src/platform/extension-platform";
import { ImportDialog } from "../../src/vault/import/ImportDialog";

const CHROME_CSV = [
  "name,url,username,password,note",
  "Example Site,https://example.test,alice,s3cret-pass,",
  "Empty Password,https://empty.test,bob,,",
].join("\n");

type Platform = OtpImportUiExtensionPlatform &
  BackupUiExtensionPlatform &
  Pick<ExtensionPlatform, "sendMessage">;

function createPlatform(sendMessage?: (payload: unknown) => Promise<unknown>): {
  platform: Platform;
  createRequests: ItemCrudRequest[];
} {
  const createRequests: ItemCrudRequest[] = [];
  const platform: Platform = {
    extensionId: "vault-test-id",
    onMessage: () => () => undefined,
    openVaultPage: () => Promise.resolve(),
    sendMessage: (payload: unknown) => {
      const request = payload as ItemCrudRequest;
      if (request.kind === "item.create" || request.kind === "item.createMany")
        createRequests.push(structuredClone(request));
      if (sendMessage !== undefined) return sendMessage(payload);
      if (request.kind === "item.createMany") {
        const items = (request as { items: readonly { id: string }[] }).items;
        return Promise.resolve({
          version: 1,
          kind: "item.createManyResult",
          results: items.map((entry, index) => ({ index, status: "created", itemId: entry.id })),
        });
      }
      return Promise.resolve({
        version: 1,
        kind: "item.mutationResult",
        item: (request as { item: unknown }).item,
      });
    },
    sendOtpImportMessage: () =>
      Promise.reject(new Error("sendOtpImportMessage not used in this test")),
    sendBackupMessage: () => Promise.reject(new Error("sendBackupMessage not used in this test")),
  };
  return { platform, createRequests };
}

function chromeFile(): File {
  return new File([CHROME_CSV], "passwords.csv", { type: "text/csv" });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ImportDialog", () => {
  it("renders nothing when inactive", () => {
    const { platform } = createPlatform();
    const { container } = render(
      <ImportDialog platform={platform} active={false} onImported={() => undefined} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("lists every import source, defaulting to Chrome CSV with local instructions", () => {
    const { platform } = createPlatform();
    render(<ImportDialog platform={platform} active onImported={() => undefined} />);

    for (const label of [
      "Chrome CSV",
      "Firefox CSV",
      "Bitwarden JSON",
      "1Password CSV",
      "QR code / otpauth://",
      "ShardPass backup",
    ]) {
      expect(screen.getByRole("button", { name: label })).toBeVisible();
    }
    expect(screen.getByRole("button", { name: "Chrome CSV" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(screen.getByText(/chrome:\/\/password-manager\/settings/i)).toBeVisible();
  });

  it("says an empty file is empty rather than too large", async () => {
    const { platform } = createPlatform();
    render(<ImportDialog platform={platform} active onImported={() => undefined} />);
    const fileInput = screen.getByLabelText("Choose a local Chrome CSV file");
    fireEvent.change(fileInput, { target: { files: [new File([], "empty.csv", { type: "text/csv" })] } });
    expect(await screen.findByText("The file is empty.")).toBeVisible();
  });

  it("parses a Chrome CSV export, previews rows, and imports only the checked ones", async () => {
    const { platform, createRequests } = createPlatform();
    const onImported = vi.fn();
    render(<ImportDialog platform={platform} active onImported={onImported} />);

    const fileInput = screen.getByLabelText("Choose a local Chrome CSV file");
    fireEvent.change(fileInput, { target: { files: [chromeFile()] } });

    await waitFor(() => expect(screen.getByText("Example Site")).toBeVisible());
    expect(screen.getByText("alice")).toBeVisible();
    expect(screen.getByText(/1 row\(s\) were skipped/i)).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Import selected" }));

    await waitFor(() => expect(createRequests).toHaveLength(1));
    expect(createRequests[0]?.kind).toBe("item.createMany");
    const item = (createRequests[0] as { items: { kind: string; name: string }[] }).items[0]!;
    expect(item.kind).toBe("login");
    expect(item.name).toBe("Example Site");
    await waitFor(() => expect(onImported).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText(/1 item imported/i)).toBeVisible());
  });

  it("excludes an unchecked row from the import", async () => {
    const { platform, createRequests } = createPlatform();
    render(<ImportDialog platform={platform} active onImported={() => undefined} />);

    fireEvent.change(screen.getByLabelText("Choose a local Chrome CSV file"), {
      target: { files: [chromeFile()] },
    });
    await waitFor(() => expect(screen.getByText("Example Site")).toBeVisible());

    fireEvent.click(screen.getByRole("checkbox", { name: /Import Example Site/i }));
    fireEvent.click(screen.getByRole("button", { name: "Import selected" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Import selected" })).toBeDisabled(),
    );
    expect(createRequests).toHaveLength(0);
  });

  it("switches to the existing OTP and ShardPass backup import surfaces", () => {
    const { platform } = createPlatform();
    render(<ImportDialog platform={platform} active onImported={() => undefined} />);

    fireEvent.click(screen.getByRole("button", { name: "QR code / otpauth://" }));
    expect(screen.getByText("Import OTP items")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "ShardPass backup" }));
    expect(screen.getByText("Encrypted backups")).toBeVisible();
  });
});
