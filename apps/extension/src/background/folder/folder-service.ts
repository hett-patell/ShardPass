import { MAX_FOLDERS, MAX_FOLDER_DEPTH, type Folder } from "@shardpass/domain";
import {
  FolderRequestSchema,
  FolderResponseSchema,
  type FolderRequest,
  type FolderResponse,
  type SenderContext,
} from "@shardpass/messaging";
import { folderDepth, folderSubtree } from "@shardpass/storage";

import type { SessionVaultRepository } from "../vault/session-vault-repository";
import { diagnostics } from "../../platform/diagnostics";

type FolderRepository = Pick<
  SessionVaultRepository,
  "readFolders" | "replaceFolders" | "listAllItems" | "updateItems"
>;

export type FolderServiceErrorCode =
  "VAULT_LOCKED" | "VAULT_UNAVAILABLE" | "FOLDER_INVALID" | "FOLDER_NOT_FOUND";

export class FolderServiceError extends Error {
  constructor(readonly code: FolderServiceErrorCode) {
    super(code);
    this.name = "FolderServiceError";
  }
}

type FolderServiceDependencies = Readonly<{
  repository: FolderRepository;
  nextId(): string;
  notePrivilegedActivity(): Promise<void>;
}>;

/**
 * Folder CRUD over the encrypted folders document. Rules: at most MAX_FOLDERS; nesting at
 * most MAX_FOLDER_DEPTH; sibling names unique ignoring case; deleting a folder deletes its
 * subtree and un-files every item that was inside it (items are never deleted with a folder).
 */
export class FolderService {
  constructor(private readonly dependencies: FolderServiceDependencies) {}

  async handle(request: FolderRequest, sender: SenderContext): Promise<FolderResponse> {
    try {
      const parsed = FolderRequestSchema.safeParse(request);
      if (!parsed.success) invalid();
      const command = parsed.data;
      if (sender.contextKind !== "vault") invalid();

      const current = await this.dependencies.repository.readFolders();
      let next: readonly Folder[] = current;
      switch (command.kind) {
        case "folder.list":
          return response(current);
        case "folder.create":
          next = this.create(current, command.name.trim(), command.parentId);
          break;
        case "folder.rename":
          next = this.rename(current, command.id, command.name.trim());
          break;
        case "folder.delete":
          next = await this.remove(current, command.id);
          break;
      }
      await this.dependencies.repository.replaceFolders(next);
      try {
        await this.dependencies.notePrivilegedActivity();
      } catch {
        // Best-effort; the mutation has already been committed.
      }
      return response(next);
    } catch (error) {
      throw mapError(error);
    }
  }

  private create(current: readonly Folder[], name: string, parentId: string | undefined): Folder[] {
    if (name === "") invalid();
    if (current.length >= MAX_FOLDERS) invalid();
    if (parentId !== undefined) {
      if (!current.some((folder) => folder.id === parentId)) notFound();
      if (folderDepth(current, parentId) >= MAX_FOLDER_DEPTH) invalid();
    }
    assertUniqueSibling(current, name, parentId, undefined);
    return [
      ...current,
      { id: this.dependencies.nextId(), name, ...(parentId === undefined ? {} : { parentId }) },
    ];
  }

  private rename(current: readonly Folder[], id: string, name: string): Folder[] {
    if (name === "") invalid();
    const target = current.find((folder) => folder.id === id);
    if (target === undefined) notFound();
    assertUniqueSibling(current, name, target.parentId, id);
    return current.map((folder) => (folder.id === id ? { ...folder, name } : folder));
  }

  private async remove(current: readonly Folder[], id: string): Promise<Folder[]> {
    if (!current.some((folder) => folder.id === id)) notFound();
    const removed = folderSubtree(current, id);
    // Un-file the items first, under one commit, so a failure leaves folders intact rather
    // than orphaning items, and a large folder is not one vault rewrite per item.
    const items = await this.dependencies.repository.listAllItems();
    const changes = items
      .filter((item) => item.folderId !== undefined && removed.has(item.folderId))
      .map((item) => {
        const { folderId: _dropped, ...candidate } = item;
        void _dropped;
        return { candidate, expectedRevision: item.revision };
      });
    if (changes.length > 0) await this.dependencies.repository.updateItems(changes);
    return current.filter((folder) => !removed.has(folder.id));
  }
}

function assertUniqueSibling(
  folders: readonly Folder[],
  name: string,
  parentId: string | undefined,
  exceptId: string | undefined,
): void {
  const key = name.normalize("NFKC").toLocaleLowerCase("en-US");
  const clash = folders.some(
    (folder) =>
      folder.id !== exceptId &&
      folder.parentId === parentId &&
      folder.name.normalize("NFKC").toLocaleLowerCase("en-US") === key,
  );
  if (clash) invalid();
}

function response(folders: readonly Folder[]): FolderResponse {
  const parsed = FolderResponseSchema.safeParse({
    version: 1,
    kind: "folder.listResult",
    folders: [...folders],
  });
  if (!parsed.success) throw new FolderServiceError("VAULT_UNAVAILABLE");
  for (const folder of parsed.data.folders) Object.freeze(folder);
  Object.freeze(parsed.data.folders);
  return Object.freeze(parsed.data);
}

function invalid(): never {
  throw new FolderServiceError("FOLDER_INVALID");
}
function notFound(): never {
  throw new FolderServiceError("FOLDER_NOT_FOUND");
}

function mapError(error: unknown): FolderServiceError {
  if (error instanceof FolderServiceError) return error;
  const code = (error as { code?: unknown } | null)?.code;
  if (code === "VAULT_LOCKED") return new FolderServiceError("VAULT_LOCKED");
  if (code === "VAULT_INVALID") return new FolderServiceError("FOLDER_INVALID");
  // An item in the folder changed under us (another page): nothing was applied; try again.
  if (code === "REVISION_CONFLICT") return new FolderServiceError("FOLDER_INVALID");
  diagnostics.error("[ShardPass] folder operation failed; reported as VAULT_UNAVAILABLE:", error);
  return new FolderServiceError("VAULT_UNAVAILABLE");
}
