import { afterEach, describe, expect, it, vi } from "vitest";

import { createKdfWorker } from "../../src/platform/kdf-executor";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("page KDF worker", () => {
  it("starts the shared-build worker entry as a module from the extension origin", () => {
    const Worker = vi.fn();
    vi.stubGlobal("Worker", Worker);
    createKdfWorker();
    expect(Worker).toHaveBeenCalledWith("/assets/kdf-worker-entry.js", { type: "module" });
  });
});
