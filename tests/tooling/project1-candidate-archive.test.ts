import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertCandidateUnchanged,
  buildAndFreezeCandidate,
} from "../../scripts/project1-candidate.mjs";
import { buildFixtureCandidate } from "./project1-candidate-harness.js";
import {
  createDeterministicArchive,
  verifyArchiveRoundTrip,
} from "../../scripts/project1-archive.mjs";

const roots: string[] = [];
async function root() {
  const value = await mkdtemp(path.join(tmpdir(), "p1-candidate-test-"));
  roots.push(value);
  return value;
}
async function thaw(directory: string): Promise<void> {
  await chmod(directory, 0o755).catch(() => undefined);
  for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => []))
    if (entry.isDirectory()) await thaw(path.join(directory, entry.name));
    else await chmod(path.join(directory, entry.name), 0o644).catch(() => undefined);
}
afterEach(async () =>
  Promise.all(
    roots.splice(0).map(async (value) => {
      await thaw(value);
      await rm(value, { recursive: true, force: true });
    }),
  ),
);
async function candidate(base: string) {
  let builds = 0;
  const value = await buildFixtureCandidate({
    workspaceRoot: base,
    runBuild: async ({ outDir, markBuild }) => {
      builds++;
      markBuild();
      await mkdir(path.join(outDir, "assets"), { recursive: true });
      await writeFile(path.join(outDir, "manifest.json"), '{"name":"ShardPass","version":"1.2.3"}');
      await writeFile(path.join(outDir, "assets/app.js"), "app\n");
      await writeFile(path.join(outDir, "notice.txt"), "notice\n");
    },
  });
  return { value, builds };
}
describe("Project 1 frozen candidate and deterministic archive", () => {
  it("removes stale output, builds exactly once, freezes and detects mutation", async () => {
    const base = await root();
    await mkdir(path.join(base, "dist"));
    await writeFile(path.join(base, "dist/stale"), "stale");
    const { value, builds } = await candidate(base);
    expect(builds).toBe(1);
    await expect(readFile(path.join(value.root, "stale"))).rejects.toThrow();
    await assertCandidateUnchanged(value);
    const directories = [value.root, path.join(value.root, "assets")];
    for (const directory of directories) expect((await stat(directory)).mode & 0o777).toBe(0o555);
    expect(await readdir(value.root)).toContain("assets");
    await chmod(path.join(value.root, "assets/app.js"), 0o644);
    await writeFile(path.join(value.root, "assets/app.js"), "changed\n");
    await expect(assertCandidateUnchanged(value)).rejects.toThrow("CANDIDATE_MUTATED");
  });
  it("freezes an existing caller-produced dist without spawning a build", async () => {
    const base = await root();
    const dist = path.join(base, "dist");
    await mkdir(dist);
    await writeFile(path.join(dist, "manifest.json"), '{"name":"ShardPass","version":"1"}');
    await writeFile(path.join(dist, "app.js"), "app\n");
    const value = await buildAndFreezeCandidate({
      workspaceRoot: base,
      distPath: dist,
      buildEvidence: {
        schemaVersion: 1,
        command:
          "pnpm exec vite build --outDir <dist> && node scripts/inventory-ente-production-graph.mjs <dist>",
        requestSha256: "a".repeat(64),
        networkResultSha256: "b".repeat(64),
        output: Buffer.from("offline build\n"),
        outputSha256: createHash("sha256").update("offline build\n").digest("hex"),
      },
    });
    expect(value.root).toBe(dist);
    expect(value.networkRequestSha256).toBe("a".repeat(64));
    expect(value.networkResultSha256).toBe("b".repeat(64));
    expect((await stat(dist)).mode & 0o777).toBe(0o555);
  });

  it("rejects mutation and malformed build evidence before freezing", async () => {
    const base = await root();
    const dist = path.join(base, "dist");
    await mkdir(dist);
    await writeFile(path.join(dist, "manifest.json"), '{"name":"ShardPass","version":"1"}');
    await expect(
      buildAndFreezeCandidate({
        workspaceRoot: base,
        distPath: dist,
        buildEvidence: { schemaVersion: 1 } as never,
      }),
    ).rejects.toThrow("CANDIDATE_BUILD_EVIDENCE_INVALID");
  });

  it("requires exactly one explicit build mark", async () => {
    const base = await root();
    await expect(
      buildFixtureCandidate({
        workspaceRoot: base,
        runBuild: async ({ outDir }) => {
          await mkdir(outDir);
          await writeFile(path.join(outDir, "manifest.json"), '{"name":"ShardPass","version":"1"}');
        },
      }),
    ).rejects.toThrow("CANDIDATE_BUILD_COUNT_INVALID");
  });
  it("rejects symlinks before identity", async () => {
    const base = await root();
    await expect(
      buildFixtureCandidate({
        workspaceRoot: base,
        runBuild: async ({ outDir, markBuild }) => {
          markBuild();
          await mkdir(outDir);
          await writeFile(path.join(outDir, "manifest.json"), '{"name":"ShardPass","version":"1"}');
          await symlink("manifest.json", path.join(outDir, "copy"));
        },
      }),
    ).rejects.toThrow("CANDIDATE_ENTRY_NONREGULAR");
  });
  it("writes byte-identical ZIPs outside candidate and round trips identity", async () => {
    const base = await root();
    const { value } = await candidate(base);
    const one = await createDeterministicArchive(value, path.join(base, "one.zip"));
    const two = await createDeterministicArchive(value, path.join(base, "two.zip"));
    expect(await readFile(one.path)).toEqual(await readFile(two.path));
    expect(one.sha256).toBe(two.sha256);
    expect(one.compression).toBe("DEFLATE-9");
    await verifyArchiveRoundTrip(value, one);
    await expect(
      createDeterministicArchive(value, path.join(value.root, "bad.zip")),
    ).rejects.toThrow("ARCHIVE_INSIDE_CANDIDATE");
    await expect(createDeterministicArchive(value, one.path)).rejects.toThrow(
      "ARCHIVE_OUTPUT_EXISTS",
    );
  });
  it("rejects non-canonical and structurally mutated archives", async () => {
    const base = await root();
    const { value } = await candidate(base);
    const archive = await createDeterministicArchive(value, path.join(base, "one.zip"));
    const bytes = await readFile(archive.path);
    const eocd = bytes.length - 22;
    const central = bytes.readUInt32LE(eocd + 16);
    const local = bytes.readUInt32LE(central + 42);
    const mutations: Buffer[] = [
      bytes.subarray(0, bytes.length - 1),
      Buffer.concat([Buffer.from("prefix"), bytes]),
      Buffer.concat([bytes, Buffer.from("trailing")]),
    ];
    for (const [offset, mutate] of [
      [
        eocd + 12,
        (copy: Buffer) => copy.writeUInt32LE(copy.readUInt32LE(eocd + 12) + 1, eocd + 12),
      ],
      [central + 8, (copy: Buffer) => copy.writeUInt16LE(0, central + 8)],
      [central + 10, (copy: Buffer) => copy.writeUInt16LE(0, central + 10)],
      [central + 12, (copy: Buffer) => copy.writeUInt16LE(1, central + 12)],
      [central + 16, (copy: Buffer) => copy.writeUInt32LE(1, central + 16)],
      [local + 6, (copy: Buffer) => copy.writeUInt16LE(0, local + 6)],
      [local + 10, (copy: Buffer) => copy.writeUInt16LE(1, local + 10)],
      [local + 14, (copy: Buffer) => copy.writeUInt32LE(1, local + 14)],
    ] as const) {
      const copy = Buffer.from(bytes);
      mutate(copy);
      expect(copy[offset]).not.toBeUndefined();
      if (!copy.equals(bytes)) mutations.push(copy);
    }
    for (const [index, mutation] of mutations.entries()) {
      const file = path.join(base, `bad-${index}.zip`);
      await writeFile(file, mutation);
      await expect(verifyArchiveRoundTrip(value, file)).rejects.toThrow();
    }
  });
});
