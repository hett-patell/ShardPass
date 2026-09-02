import { describe, expect, it } from "vitest";

import { classifyChromiumStartupStderr } from "./startup-diagnostics";

describe("Chromium startup diagnostics", () => {
  it("catches a synthetic fatal extension error emitted before target listeners attach", () => {
    const stderr = [
      "[123:456:INFO:chrome_main.cc(1)] benign startup detail",
      "[123:456:FATAL:extensions/browser/extension_registry.cc(2)] synthetic startup failure",
    ].join("\n");

    expect(classifyChromiumStartupStderr(stderr)).toEqual([
      "[FATAL:extensions/browser/extension_registry.cc]",
    ]);
  });

  it("allowlists only exact known benign process-start patterns", () => {
    const stderr = [
      "DevTools listening on ws://127.0.0.1:123/devtools/browser/id",
      "[123:456:WARNING:bus.cc(1)] Failed to connect to the bus: Address does not contain a colon",
      "[123:456:ERROR:object_proxy.cc(1)] Failed to call method: org.freedesktop.DBus.NameHasOwner",
    ].join("\n");

    expect(classifyChromiumStartupStderr(stderr)).toEqual([]);
  });
});
