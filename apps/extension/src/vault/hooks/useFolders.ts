import type { Folder } from "@shardpass/domain";
import { parseFolderResponseForRequest, type FolderRequest } from "@shardpass/messaging";
import { useCallback, useEffect, useRef, useState } from "react";

import type { ExtensionPlatform } from "../../platform/extension-platform";

export type FolderStatus = "idle" | "loading" | "ready" | "error";

export interface UseFoldersResult {
  folders: readonly Folder[];
  status: FolderStatus;
  /** The last mutation's failure, worded for a person; cleared on the next attempt. */
  error: string | null;
  /** Forget the last failure, e.g. when the person abandons the attempt. */
  clearError: () => void;
  refresh: () => void;
  create: (name: string, parentId?: string) => Promise<boolean>;
  rename: (id: string, name: string) => Promise<boolean>;
  remove: (id: string) => Promise<boolean>;
}

const none: readonly Folder[] = Object.freeze([]);

function describe(candidate: unknown): string {
  const code = (candidate as { error?: { code?: unknown } } | null)?.error?.code;
  switch (code) {
    case "FOLDER_INVALID":
      return "That name is already used here, or the folder is nested too deep.";
    case "FOLDER_NOT_FOUND":
      return "That folder no longer exists. Refresh and try again.";
    case "VAULT_LOCKED":
      return "The vault is locked.";
    default:
      return "Could not save the folder. Try again.";
  }
}

/** Folder list plus create/rename/delete, each answered by the full list from the background. */
export function useFolders(
  platform: Pick<ExtensionPlatform, "sendMessage">,
  active: boolean,
): UseFoldersResult {
  const [folders, setFolders] = useState<readonly Folder[]>(none);
  const [status, setStatus] = useState<FolderStatus>(active ? "loading" : "idle");
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);

  const send = useCallback(
    async (request: FolderRequest): Promise<boolean> => {
      const token = ++generation.current;
      setError(null);
      try {
        const candidate = await platform.sendMessage(request);
        if (token !== generation.current) return false;
        const parsed = parseFolderResponseForRequest(request, candidate);
        if (!parsed.success) {
          if (request.kind === "folder.list") setStatus("error");
          else setError(describe(candidate));
          return false;
        }
        setFolders(parsed.data.folders);
        setStatus("ready");
        return true;
      } catch {
        if (token !== generation.current) return false;
        if (request.kind === "folder.list") setStatus("error");
        else setError("Could not reach the background service.");
        return false;
      }
    },
    [platform],
  );

  const refresh = useCallback(() => {
    if (active) void send({ version: 1, kind: "folder.list" });
  }, [active, send]);
  const clearError = useCallback(() => setError(null), []);

  useEffect(() => {
    if (!active) {
      generation.current += 1;
      setFolders(none);
      setStatus("idle");
      setError(null);
      return;
    }
    void send({ version: 1, kind: "folder.list" });
  }, [active, send]);

  return {
    folders,
    clearError,
    status,
    error,
    refresh,
    create: (name, parentId) =>
      send({
        version: 1,
        kind: "folder.create",
        name,
        ...(parentId === undefined ? {} : { parentId }),
      }),
    rename: (id, name) => send({ version: 1, kind: "folder.rename", id, name }),
    remove: (id) => send({ version: 1, kind: "folder.delete", id }),
  };
}
