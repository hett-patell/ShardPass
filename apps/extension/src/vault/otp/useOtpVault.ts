import type {
  OtpEditableInput,
  OtpEditorProjection,
  OtpListItemProjection,
  OtpResponse,
} from "@shardpass/messaging";
import { useCallback, useEffect, useRef, useState } from "react";

import type { OtpUiExtensionPlatform } from "../../platform/extension-platform";

export type OtpVaultState = Readonly<{
  status: "locked" | "loading" | "ready" | "error";
  items: readonly OtpListItemProjection[];
  editor: OtpEditorProjection | null;
  selectedId: string | null;
  loadingEditor: boolean;
}>;

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

function isList(
  response: OtpResponse,
): response is Extract<OtpResponse, { kind: "otp.listResult" }> {
  return response.kind === "otp.listResult";
}

function isEditor(
  response: OtpResponse,
): response is Extract<OtpResponse, { kind: "otp.editorResult" }> {
  return response.kind === "otp.editorResult";
}

export function useOtpVault(platform: OtpUiExtensionPlatform, active: boolean) {
  const [query, setQueryState] = useState("");
  const [state, setState] = useState<OtpVaultState>({
    status: active ? "loading" : "locked",
    items: [],
    editor: null,
    selectedId: null,
    loadingEditor: false,
  });
  const generation = useRef(0);
  const listRequest = useRef(0);
  const editorRequest = useRef(0);
  const operation = useRef(0);
  const selectedRef = useRef<string | null>(null);
  const queryRef = useRef("");
  selectedRef.current = state.selectedId;
  const setQuery = useCallback((value: string) => {
    queryRef.current = value;
    setQueryState(value);
  }, []);

  const refreshList = useCallback(
    async (requestedQuery = query.trim(), preferredId?: string | null) => {
      if (!active) return;
      const lifecycle = generation.current;
      const request = ++listRequest.current;
      setState((current) => ({ ...current, status: current.items.length ? "ready" : "loading" }));
      try {
        const response = await platform.sendOtpMessage({
          version: 1,
          kind: "otp.list",
          query: requestedQuery,
        });
        if (
          lifecycle !== generation.current ||
          request !== listRequest.current ||
          !isList(response)
        )
          return;
        const desired = preferredId === undefined ? selectedRef.current : preferredId;
        const selectedId =
          desired !== null && response.items.some(({ id }) => id === desired) ? desired : null;
        setState((current) => ({
          ...current,
          status: "ready",
          items: response.items,
          selectedId,
          editor: current.editor?.id === selectedId ? current.editor : null,
          loadingEditor: false,
        }));
      } catch {
        if (lifecycle === generation.current && request === listRequest.current) {
          editorRequest.current += 1;
          operation.current += 1;
          selectedRef.current = null;
          setState({
            status: "error",
            items: [],
            editor: null,
            selectedId: null,
            loadingEditor: false,
          });
        }
      }
    },
    [active, platform, query],
  );

  useEffect(() => {
    if (!active) {
      generation.current += 1;
      listRequest.current += 1;
      editorRequest.current += 1;
      operation.current += 1;
      selectedRef.current = null;
      queryRef.current = "";
      setQueryState("");
      setState({
        status: "locked",
        items: [],
        editor: null,
        selectedId: null,
        loadingEditor: false,
      });
      return;
    }
    const timer = setTimeout(() => void refreshList(query.trim()), query === "" ? 0 : 150);
    return () => clearTimeout(timer);
  }, [active, query, refreshList]);

  useEffect(
    () => () => {
      generation.current += 1;
      listRequest.current += 1;
      editorRequest.current += 1;
      operation.current += 1;
    },
    [],
  );

  const select = useCallback(
    async (itemId: string) => {
      if (!active) return;
      const lifecycle = generation.current;
      operation.current += 1;
      const request = ++editorRequest.current;
      setState((current) => ({
        ...current,
        selectedId: itemId,
        editor: current.editor?.id === itemId ? current.editor : null,
        loadingEditor: true,
      }));
      try {
        const response = await platform.sendOtpMessage({
          version: 1,
          kind: "otp.getEditor",
          itemId,
        });
        if (
          lifecycle !== generation.current ||
          request !== editorRequest.current ||
          !isEditor(response) ||
          response.item.id !== itemId
        )
          return;
        setState((current) => ({ ...current, editor: response.item, loadingEditor: false }));
      } catch {
        if (lifecycle === generation.current && request === editorRequest.current)
          setState((current) => ({ ...current, loadingEditor: false }));
      }
    },
    [active, platform],
  );

  const create = useCallback(
    async (input: OtpEditableInput) => {
      const lifecycle = generation.current;
      const operationToken = ++operation.current;
      const response = await platform.sendOtpMessage({ version: 1, kind: "otp.create", input });
      if (
        lifecycle !== generation.current ||
        operationToken !== operation.current ||
        response.kind !== "otp.mutationResult"
      )
        return null;
      await refreshList(query.trim(), response.item.id);
      if (operationToken !== operation.current) return null;
      await select(response.item.id);
      return response.item;
    },
    [platform, query, refreshList, select],
  );

  const update = useCallback(
    async (itemId: string, expectedRevision: number, input: OtpEditableInput) => {
      const lifecycle = generation.current;
      const operationToken = ++operation.current;
      try {
        const response = await platform.sendOtpMessage({
          version: 1,
          kind: "otp.update",
          itemId,
          expectedRevision,
          input,
        });
        if (
          lifecycle !== generation.current ||
          operationToken !== operation.current ||
          response.kind !== "otp.mutationResult"
        )
          return { status: "inactive" as const };
        await refreshList(query.trim(), itemId);
        if (operationToken !== operation.current) return { status: "inactive" as const };
        await select(itemId);
        return { status: "saved" as const };
      } catch (error) {
        if (lifecycle !== generation.current || operationToken !== operation.current)
          return { status: "inactive" as const };
        if (errorCode(error) !== "OTP_CONFLICT") throw error;
        await refreshList(query.trim(), itemId);
        if (operationToken !== operation.current) return { status: "inactive" as const };
        await select(itemId);
        return { status: "conflict" as const };
      }
    },
    [platform, query, refreshList, select],
  );

  const remove = useCallback(
    async (itemId: string, expectedRevision: number) => {
      const lifecycle = generation.current;
      const operationToken = ++operation.current;
      try {
        const response = await platform.sendOtpMessage({
          version: 1,
          kind: "otp.delete",
          itemId,
          expectedRevision,
        });
        if (lifecycle !== generation.current || response.kind !== "otp.deleteResult")
          return { status: "inactive" as const };
        if (operationToken !== operation.current) {
          setState((current) => ({
            ...current,
            items: current.items.filter(({ id }) => id !== itemId),
          }));
          const latestQuery = queryRef.current.trim();
          if (latestQuery === query.trim()) await refreshList(latestQuery);
          return { status: "reconciled" as const };
        }
        await refreshList(query.trim(), null);
        if (operationToken !== operation.current) return { status: "inactive" as const };
        return { status: "deleted" as const };
      } catch (error) {
        if (lifecycle !== generation.current || operationToken !== operation.current)
          return { status: "inactive" as const };
        if (errorCode(error) !== "OTP_CONFLICT") throw error;
        await refreshList(query.trim(), itemId);
        if (operationToken !== operation.current) return { status: "inactive" as const };
        await select(itemId);
        return { status: "conflict" as const };
      }
    },
    [platform, query, refreshList, select],
  );

  const clearSelection = useCallback(() => {
    editorRequest.current += 1;
    operation.current += 1;
    selectedRef.current = null;
    setState((current) => ({
      ...current,
      selectedId: null,
      editor: null,
      loadingEditor: false,
    }));
  }, []);

  return { state, query, setQuery, select, clearSelection, create, update, remove, refreshList };
}
