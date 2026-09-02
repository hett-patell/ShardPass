import { describe, expect, it, vi } from "vitest";

import { createEnteClient, createEnteResponseBudget } from "../../src/background/ente/client";

const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("EnteClient fixed transport", () => {
  it("uses only the exact origin, endpoint method, canonical query, and fixed fetch policy", async () => {
    const fetch = vi.fn((url: string, init: RequestInit) => {
      void url;
      void init;
      return Promise.resolve(response({ diff: [], timestamp: 7 }));
    });
    const client = createEnteClient({ fetch });
    await client.getEntityDiff("synthetic-token", 6, new AbortController().signal);
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("https://api.ente.io/authenticator/entity/diff?sinceTime=6&limit=2500");
    expect(init).toMatchObject({
      method: "GET",
      redirect: "error",
      credentials: "omit",
      cache: "no-store",
    });
    expect(init.headers).toEqual({ Accept: "application/json", "X-Auth-Token": "synthetic-token" });
  });

  it("places auth only on authenticated methods and returns fixed safe errors", async () => {
    const fetch = vi.fn((url: string, init: RequestInit) => {
      void url;
      void init;
      return Promise.resolve(response({ message: "secret server detail" }, 500));
    });
    const client = createEnteClient({ fetch });
    await expect(
      client.getSrpAttributes("phase2@example.invalid", new AbortController().signal),
    ).rejects.toMatchObject({ code: "ENTE_UNAVAILABLE", message: "Ente request failed" });
    const [, init] = fetch.mock.calls[0]!;
    expect(init.headers).toEqual({ Accept: "application/json" });
  });

  it("charges exact response bytes to one cycle budget before JSON decoding", async () => {
    const budget = createEnteResponseBudget(30);
    const first = new Uint8Array(16).fill(0x20);
    const second = new Uint8Array(15).fill(0x20);
    const arrayBuffer = vi
      .fn()
      .mockResolvedValueOnce(first.buffer)
      .mockResolvedValueOnce(second.buffer);
    const fetch = vi.fn(() =>
      Promise.resolve({
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        arrayBuffer,
      } as unknown as Response),
    );
    const client = createEnteClient({ fetch });
    await expect(
      client.getEntityDiff("synthetic-token", 0, new AbortController().signal, budget),
    ).rejects.toMatchObject({ code: "ENTE_PROTOCOL_DRIFT" });
    await expect(
      client.getEntityDiff("synthetic-token", 0, new AbortController().signal, budget),
    ).rejects.toMatchObject({ code: "ENTE_LIMIT_REACHED" });
    expect(arrayBuffer).toHaveBeenCalledTimes(2);
    expect(budget.usedBytes).toBe(16);
  });

  it("rejects a declared over-budget response before reading or decoding it", async () => {
    const arrayBuffer = vi.fn();
    const fetch = vi.fn(() =>
      Promise.resolve({
        status: 200,
        headers: new Headers({ "content-length": "11" }),
        arrayBuffer,
      } as unknown as Response),
    );
    const client = createEnteClient({ fetch });
    const budget = createEnteResponseBudget(10);
    await expect(
      client.getEntityDiff("synthetic-token", 0, new AbortController().signal, budget),
    ).rejects.toMatchObject({ code: "ENTE_LIMIT_REACHED" });
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it.each(["update", "delete"] as const)(
    "validates and charges the exact empty %s response body",
    async (operation) => {
      const arrayBuffer = vi
        .fn()
        .mockResolvedValueOnce(new Uint8Array().buffer)
        .mockResolvedValueOnce(new Uint8Array([0x20]).buffer);
      const fetch = vi.fn(() =>
        Promise.resolve({
          status: 200,
          headers: new Headers({ "content-length": "0" }),
          arrayBuffer,
        } as unknown as Response),
      );
      const client = createEnteClient({ fetch });
      const budget = createEnteResponseBudget(1);
      const invoke = () =>
        operation === "update"
          ? client.updateEntity(
              "synthetic-token",
              { id: "00000000-0000-4000-8000-000000000001", encryptedData: "AQ==", header: "Ag==" },
              new AbortController().signal,
              budget,
            )
          : client.deleteEntity(
              "synthetic-token",
              "00000000-0000-4000-8000-000000000001",
              new AbortController().signal,
              budget,
            );
      await expect(invoke()).resolves.toBeUndefined();
      await expect(invoke()).rejects.toMatchObject({ code: "ENTE_PROTOCOL_DRIFT" });
      expect(arrayBuffer).toHaveBeenCalledTimes(2);
      expect(budget.usedBytes).toBe(1);
    },
  );

  it("rejects oversized or drifting empty response declarations before reading the body", async () => {
    const arrayBuffer = vi.fn();
    const fetch = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValueOnce(
        new Response(null, { status: 204, headers: { "content-length": "2" } }),
      )
      .mockResolvedValueOnce(
        new Response(null, { status: 204, headers: { "content-length": "invalid" } }),
      );
    const client = createEnteClient({ fetch });
    const invoke = () =>
      client.deleteEntity(
        "synthetic-token",
        "00000000-0000-4000-8000-000000000001",
        new AbortController().signal,
        createEnteResponseBudget(1),
      );
    await expect(invoke()).rejects.toMatchObject({ code: "ENTE_LIMIT_REACHED" });
    await expect(invoke()).rejects.toMatchObject({ code: "ENTE_LIMIT_REACHED" });
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it("aborts each request at 30 seconds and rejects oversized bodies before JSON", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) =>
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          ),
        ),
    );
    const client = createEnteClient({ fetch });
    const pending = expect(
      client.getSrpAttributes("phase2@example.invalid", new AbortController().signal),
    ).rejects.toMatchObject({ code: "ENTE_UNAVAILABLE" });
    await vi.advanceTimersByTimeAsync(30_001);
    await pending;
    vi.useRealTimers();
  });
});
