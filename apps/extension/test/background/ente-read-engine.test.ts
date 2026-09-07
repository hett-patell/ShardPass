import { describe, expect, it, vi } from "vitest";

import { createEnteResponseBudget } from "../../src/background/ente/client";
import { readRemoteState } from "../../src/background/ente/read-engine";

const uuid = (value: number) => `00000000-0000-4000-8000-${value.toString().padStart(12, "0")}`;
const tombstone = (id: string, updatedAt: number) => ({
  id,
  encryptedData: null,
  header: null,
  isDeleted: true as const,
  createdAt: 1,
  updatedAt,
});
const live = (id: string, updatedAt: number, data = "Ag==") => ({
  id,
  encryptedData: data,
  header: "Ag==",
  isDeleted: false as const,
  createdAt: 1,
  updatedAt,
});
type DiffMethod = Parameters<typeof readRemoteState>[0]["client"]["getEntityDiff"];
const read = (getEntityDiff: DiffMethod, forceSnapshot = true, sinceTime = 0) =>
  readRemoteState({
    client: { getEntityDiff },
    token: "token",
    sinceTime,
    forceSnapshot,
    signal: new AbortController().signal,
  });

describe("bounded Ente read engine", () => {
  it("shares one response budget across ambiguous incremental and snapshot fallback", async () => {
    const budget = createEnteResponseBudget(64);
    const getEntityDiff = vi
      .fn()
      .mockResolvedValueOnce({ diff: [tombstone(uuid(1), 5)], timestamp: 5 })
      .mockResolvedValueOnce({ diff: [], timestamp: 6 });
    await readRemoteState({
      client: { getEntityDiff },
      token: "token",
      sinceTime: 5,
      forceSnapshot: false,
      signal: new AbortController().signal,
      budget,
    });
    expect(getEntityDiff).toHaveBeenNthCalledWith(1, "token", 5, expect.any(AbortSignal), budget);
    expect(getEntityDiff).toHaveBeenNthCalledWith(2, "token", 0, expect.any(AbortSignal), budget);
  });

  it("discards an ambiguous incremental and falls back exactly once from zero", async () => {
    const getEntityDiff = vi
      .fn()
      .mockResolvedValueOnce({ diff: [tombstone(uuid(1), 5)], timestamp: 5 })
      .mockResolvedValueOnce({ diff: [], timestamp: 6 });
    const result = await read(getEntityDiff, false, 5);
    expect(result.mode).toBe("snapshot");
    expect(result.complete).toBe(true);
    expect(getEntityDiff).toHaveBeenNthCalledWith(1, "token", 5, expect.any(AbortSignal));
    expect(getEntityDiff).toHaveBeenNthCalledWith(2, "token", 0, expect.any(AbortSignal));
    expect(getEntityDiff).toHaveBeenCalledTimes(2);
  });

  it("rejects server timestamp regression and timestamp/entity-domain contradictions", async () => {
    await expect(
      read(vi.fn().mockResolvedValue({ diff: [live(uuid(1), 7)], timestamp: 6 })),
    ).rejects.toMatchObject({ code: "ENTE_TIMESTAMP_AMBIGUOUS" });
    const regressed = vi
      .fn()
      .mockResolvedValueOnce({ diff: [], timestamp: 0 })
      .mockResolvedValueOnce({ diff: [], timestamp: 9 });
    await expect(read(regressed, false, 8)).resolves.toMatchObject({
      mode: "snapshot",
      complete: true,
    });
  });

  it("accepts exact repeats and deterministically applies a later observation", async () => {
    const id = uuid(1);
    const getEntityDiff = vi
      .fn()
      .mockResolvedValueOnce({ diff: [live(id, 1), live(id, 1)], timestamp: 1 })
      .mockResolvedValueOnce({ diff: [live(id, 3, "Aw==")], timestamp: 3 });
    const first = await read(getEntityDiff);
    expect(first.entities.get(id)).toMatchObject({ updatedAt: 1, encryptedData: "Ag==" });
    const second = await read(getEntityDiff);
    expect(second.entities.get(id)).toMatchObject({ updatedAt: 3, encryptedData: "Aw==" });
  });

  it("rejects same-time live/live and live/tombstone contradictions", async () => {
    const id = uuid(1);
    for (const diff of [
      [live(id, 2, "Ag=="), live(id, 2, "Aw==")],
      [live(id, 2), tombstone(id, 2)],
    ])
      await expect(read(vi.fn().mockResolvedValue({ diff, timestamp: 3 }))).rejects.toMatchObject({
        code: "ENTE_TIMESTAMP_AMBIGUOUS",
      });
  });

  it("reconstructs a multipage snapshot and lets a later tombstone remove live state", async () => {
    const first = Array.from({ length: 2_500 }, (_, index) => live(uuid(index + 1), index + 1));
    const getEntityDiff = vi
      .fn()
      .mockResolvedValueOnce({ diff: first, timestamp: 2_500 })
      .mockResolvedValueOnce({ diff: [tombstone(uuid(1), 2_501)], timestamp: 2_501 });
    const result = await read(getEntityDiff);
    expect(result.complete).toBe(true);
    // The tombstone stays in the snapshot so the planner sees the deletion rather than
    // "unchanged"; only the live count drops.
    expect(result.entities.size).toBe(2_500);
    expect(result.entities.get(uuid(1))?.isDeleted).toBe(true);
    expect([...result.entities.values()].filter((entity) => !entity.isDeleted)).toHaveLength(2_499);
    expect(result.nextCursor).toBe(2_501);
    expect(getEntityDiff).toHaveBeenNthCalledWith(2, "token", 2_500, expect.any(AbortSignal));
  });

  it("rejects an actual 2,500-row full page with an equal maximum boundary", async () => {
    const diff = Array.from({ length: 2_500 }, (_, index) =>
      live(uuid(index + 1), index < 2_498 ? index + 1 : 2_499),
    );
    await expect(read(vi.fn().mockResolvedValue({ diff, timestamp: 2_499 }))).rejects.toMatchObject(
      {
        code: "ENTE_TIMESTAMP_AMBIGUOUS",
      },
    );
  });

  it("enforces the substantive 40-page and 100,000-change bounds", async () => {
    let cursor = 0;
    const page = () => {
      const diff = Array.from({ length: 2_500 }, (_, index) =>
        tombstone(uuid(((cursor + index) % 10_000) + 1), cursor + index + 1),
      );
      cursor += 2_500;
      return { diff, timestamp: cursor };
    };
    await expect(read(vi.fn(() => Promise.resolve(page())))).rejects.toMatchObject({
      code: "ENTE_LIMIT_REACHED",
    });
    expect(cursor).toBe(100_000);
  });

  it("retains more than 10,000 incremental tombstones without counting them as live", async () => {
    let cursor = 0;
    const getEntityDiff = vi.fn(() => {
      const size = cursor < 12_500 ? 2_500 : 0;
      const diff = Array.from({ length: size }, (_, index) =>
        tombstone(uuid(cursor + index + 1), cursor + index + 1),
      );
      cursor += size;
      return Promise.resolve({ diff, timestamp: cursor });
    });
    const result = await read(getEntityDiff, false, 0);
    expect(result.mode).toBe("incremental");
    expect(result.entities.size).toBe(12_500);
    expect([...result.entities.values()].filter((entity) => !entity.isDeleted)).toHaveLength(0);
    expect(getEntityDiff).toHaveBeenCalledTimes(6);
  });

  it("enforces the reconstructed aggregate 10,000-live bound across pages", async () => {
    let cursor = 0;
    const getEntityDiff = vi.fn(() => {
      const size = cursor < 10_000 ? 2_500 : 1;
      const diff = Array.from({ length: size }, (_, index) =>
        live(uuid(cursor + index + 1), cursor + index + 1),
      );
      cursor += size;
      return Promise.resolve({ diff, timestamp: cursor });
    });
    await expect(read(getEntityDiff)).rejects.toMatchObject({ code: "ENTE_LIMIT_REACHED" });
  });
});
