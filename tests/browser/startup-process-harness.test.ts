import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { collectStartupProcessEvidence } from "./startup-process-harness";

const projectRoot = path.resolve(import.meta.dirname, "../..");

describe("clean Chromium process startup", () => {
  it("captures process stderr from spawn and then observes the ShardPass worker over CDP", async () => {
    const profile = await mkdtemp(path.join(tmpdir(), "shardpass-startup-process-"));
    const evidence = await collectStartupProcessEvidence(profile, path.join(projectRoot, "dist"));

    expect(evidence).toEqual({
      extensionTargetObserved: true,
      localKeyCount: 0,
      sessionKeyCount: 0,
      stderrFindings: [],
      targetExceptions: [],
    });
  }, 60_000);
});
