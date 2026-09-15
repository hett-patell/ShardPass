import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import manifest from "../../apps/extension/src/manifest";
import {
  ENTE_API_ORIGIN,
  ENTE_PROTOCOL_ENDPOINTS,
} from "../../apps/extension/src/background/ente/protocol";

const approvedCsp =
  "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; connect-src 'self' https://api.ente.io https://api.pwnedpasswords.com; img-src 'self' data:; media-src 'self'; font-src 'self'; style-src 'self'";

describe("Task 12 production network policy", () => {
  it("allows only the exact Ente origin and protocol table", async () => {
    expect(ENTE_API_ORIGIN).toBe("https://api.ente.io");
    const sourceManifest = manifest as {
      host_permissions?: string[];
      content_security_policy: { extension_pages: string };
    };
    expect(sourceManifest.host_permissions).toEqual(["https://api.ente.io/*"]);
    expect(sourceManifest.content_security_policy.extension_pages).toBe(approvedCsp);
    expect(ENTE_PROTOCOL_ENDPOINTS).toEqual([
      ["GET", "/users/srp/attributes"],
      ["POST", "/users/srp/create-session"],
      ["POST", "/users/srp/verify-session"],
      ["POST", "/users/two-factor/verify"],
      ["GET", "/authenticator/key"],
      ["GET", "/authenticator/entity/diff"],
      ["POST", "/authenticator/entity"],
      ["PUT", "/authenticator/entity"],
      ["DELETE", "/authenticator/entity"],
    ]);
    const client = await readFile(
      new URL("../../apps/extension/src/background/ente/client.ts", import.meta.url),
      "utf8",
    );
    expect(client).toContain('redirect: "error"');
    expect(client).toContain('credentials: "omit"');
    expect(client).not.toMatch(
      /WebSocket|EventSource|sendBeacon|XMLHttpRequest|serverUrl|baseUrl/u,
    );
  });
});
