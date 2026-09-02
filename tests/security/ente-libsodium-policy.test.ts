import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(new URL("../../", import.meta.url).pathname);
const wrapperIntegrity =
  "sha512-ql7hcgulKZ3ekfa2DGAogcCKsWU0diA/0nArz1CFzh93WQdb46/Kj18ka/Hifq6uA3Ush34Pc6vU/6HXeRwUkg==";
const wasmIntegrity =
  "sha512-Afy7Ya+jUT+JeBx93Vk83tFhmhOjLN521dVPYKi/KiLdHoSsa2j7qf9gxZmvo0HpVxlqhdrLX6nHhVPrfMqRhA==";

describe("exact libsodium dependency policy", () => {
  it("pins direct wrapper, transitive WASM override and registry integrities", async () => {
    const extension = JSON.parse(
      await readFile(resolve(root, "apps/extension/package.json"), "utf8"),
    ) as { dependencies: Record<string, string> };
    const workspace = JSON.parse(await readFile(resolve(root, "package.json"), "utf8")) as {
      pnpm: { overrides: Record<string, string> };
    };
    const lock = await readFile(resolve(root, "pnpm-lock.yaml"), "utf8");
    expect(extension.dependencies["libsodium-wrappers-sumo"]).toBe("catalog:");
    expect(workspace.pnpm.overrides["libsodium-sumo"]).toBe("0.8.0");
    expect(lock).toContain("libsodium-wrappers-sumo@0.8.4:");
    expect(lock).toContain(wrapperIntegrity);
    expect(lock).toContain("libsodium-sumo@0.8.0:");
    expect(lock).toContain(wasmIntegrity);
    expect(lock).toMatch(/libsodium-wrappers-sumo@0\.8\.4:[\s\S]*?libsodium-sumo: 0\.8\.0/u);
  });

  it("derives wrapper and sumo license/repository/integrity policy from installed metadata", async () => {
    const lock = await readFile(resolve(root, "pnpm-lock.yaml"), "utf8");
    for (const expected of [
      {
        directory: "libsodium-wrappers-sumo@0.8.4",
        name: "libsodium-wrappers-sumo",
        version: "0.8.4",
        integrity: wrapperIntegrity,
      },
      {
        directory: "libsodium-sumo@0.8.0",
        name: "libsodium-sumo",
        version: "0.8.0",
        integrity: wasmIntegrity,
      },
    ]) {
      const metadata = JSON.parse(
        await readFile(
          resolve(
            root,
            "node_modules/.pnpm",
            expected.directory,
            "node_modules",
            expected.name,
            "package.json",
          ),
          "utf8",
        ),
      ) as {
        name: string;
        version: string;
        license: string;
        repository: { type: string; url: string };
      };
      expect(metadata).toMatchObject({
        name: expected.name,
        version: expected.version,
        license: "ISC",
        repository: {
          type: "git",
          url: "git+https://github.com/jedisct1/libsodium.js.git",
        },
      });
      expect(lock).toContain(`${expected.name}@${expected.version}:`);
      expect(lock).toContain(expected.integrity);
    }
  });

  it("centralizes production wrapper access and has no runtime download fallback", async () => {
    const source = await readFile(
      resolve(root, "apps/extension/src/background/ente/sodium-adapter.ts"),
      "utf8",
    );
    expect(source).toContain('from "libsodium-wrappers-sumo"');
    expect(source).not.toMatch(
      /fetch\(|XMLHttpRequest|https?:|WebSocket|EventSource|eval\(|new Function/u,
    );
  });
});
