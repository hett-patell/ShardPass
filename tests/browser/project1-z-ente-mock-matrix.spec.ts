import { Buffer } from "node:buffer";

import type { BrowserContext, Page } from "@playwright/test";
import { canonicalJson } from "../../packages/storage/src/index";
import sodium from "../../apps/extension/node_modules/libsodium-wrappers-sumo/dist/modules-sumo/libsodium-wrappers.js";
import srp from "../../apps/extension/node_modules/fast-srp-hap/lib/srp.js";

import {
  expect,
  expectNoSeriousAxeViolations,
  expectVaultUnlocked,
  openEnteSync,
  stabilizePage,
  test,
} from "./fixtures";

test.use({ screenLockStabilized: true });

const ids = {
  user: "10000000-0000-4000-8000-000000000001",
  session: "10000000-0000-4000-8000-000000000002",
  twoFactor: "10000000-0000-4000-8000-000000000003",
};
const email = "mock@example.test";
const password = "deterministic mock password";
const token = "synthetic-runtime-token";
const b64 = (value: Uint8Array | Buffer) => Buffer.from(value).toString("base64");

type MockMutation = Readonly<{ method: string; path: string; body: unknown }>;
type RequestObservation = Readonly<{
  method: string;
  path: string;
  accept: string | undefined;
  contentType: string | undefined;
  auth: string | undefined;
}>;
type OtpProjection = Readonly<{
  version: 1;
  kind: "otp";
  otpType: "totp";
  issuer: string;
  label: string;
  secretBase32: string;
  algorithm: "SHA1";
  digits: 6;
  period: 30;
}>;
type MockEntity = Readonly<{
  id: string;
  encryptedData: string | null;
  header: string | null;
  isDeleted: boolean;
  createdAt: number;
  updatedAt: number;
}>;

async function installStrictMock(
  context: BrowserContext,
  options: Readonly<{ requireTotp?: boolean }> = {},
): Promise<{
  readonly requests: string[];
  readonly observations: readonly RequestObservation[];
  readonly mutationLog: () => readonly MockMutation[];
  readonly mutations: () => number;
  readonly entityIds: () => readonly string[];
  readonly entity: (id: string) => MockEntity | undefined;
  remoteEdit(id: string, projection: OtpProjection): void;
  remoteDelete(id: string): void;
  failNextMutationAfterCommit(): void;
}> {
  await sodium.ready;
  const requests: string[] = [];
  const observations: RequestObservation[] = [];
  const mutationLog: MockMutation[] = [];
  const entities = new Map<string, MockEntity>();
  let failAfterCommit = false;
  let timestamp = 1;
  let nextEntity = 100;
  let observedAuthToken = "none";
  const srpSalt = Buffer.alloc(32, 7);
  const kekSalt = new Uint8Array(16).fill(8);
  const opsLimit = sodium.crypto_pwhash_OPSLIMIT_MIN;
  const memLimit = sodium.crypto_pwhash_MEMLIMIT_MIN;
  const kek = sodium.crypto_pwhash(
    32,
    new TextEncoder().encode(password),
    kekSalt,
    opsLimit,
    memLimit,
    sodium.crypto_pwhash_ALG_ARGON2ID13,
  );
  // Matches Ente: a 32-byte "loginctx" subkey, first 16 bytes. (A direct 16-byte derivation
  // is a different key -- BLAKE2b output length is part of the hash parameters.)
  const loginKey = sodium.crypto_kdf_derive_from_key(32, 1, "loginctx", kek).slice(0, 16);
  const verifier = srp.SRP.computeVerifier(
    srp.SRP.params[4096],
    srpSalt,
    Buffer.from(ids.user),
    Buffer.from(loginKey),
  );
  let server = new srp.SrpServer(srp.SRP.params[4096], verifier, Buffer.alloc(64, 9));
  const masterKey = new Uint8Array(32).fill(10);
  const authKey = new Uint8Array(32).fill(11);
  const keyNonce = new Uint8Array(24).fill(12);
  const authNonce = new Uint8Array(24).fill(13);
  const tokenKeyPair = sodium.crypto_box_keypair();
  const tokenSecretNonce = new Uint8Array(24).fill(14);
  const keyAttributes = {
    encryptedKey: b64(sodium.crypto_secretbox_easy(masterKey, keyNonce, kek)),
    keyDecryptionNonce: b64(keyNonce),
    encryptedSecretKey: b64(
      sodium.crypto_secretbox_easy(tokenKeyPair.privateKey, tokenSecretNonce, masterKey),
    ),
    secretKeyDecryptionNonce: b64(tokenSecretNonce),
    publicKey: b64(tokenKeyPair.publicKey),
  };
  const encryptedToken = b64(
    sodium.crypto_box_seal(new TextEncoder().encode(token), tokenKeyPair.publicKey),
  );
  const expectedAuthToken = options.requireTotp
    ? Buffer.from(token).toString("base64url")
    : b64(Buffer.from(token));
  const authenticatorKey = {
    encryptedKey: b64(sodium.crypto_secretbox_easy(authKey, authNonce, masterKey)),
    header: b64(authNonce),
  };

  await context.route("https://api.ente.io/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const key = `${request.method()} ${url.pathname}${url.search}`;
    requests.push(key);
    const fulfill = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    const headers = request.headers();
    observations.push({
      method: request.method(),
      path: `${url.pathname}${url.search}`,
      accept: headers.accept,
      contentType: headers["content-type"],
      auth: headers["x-auth-token"],
    });
    if (url.origin !== "https://api.ente.io" || headers.accept !== "application/json")
      throw new Error(`unexpected authority or Accept header: ${key}`);
    if (
      request.method() === "GET" &&
      url.pathname === "/users/srp/attributes" &&
      url.searchParams.get("email") === email
    )
      return fulfill({
        attributes: {
          srpUserID: ids.user,
          srpSalt: b64(srpSalt),
          memLimit,
          opsLimit,
          kekSalt: b64(kekSalt),
          isEmailMFAEnabled: options.requireTotp ?? false,
        },
      });
    if (request.method() === "POST" && url.pathname === "/users/srp/create-session") {
      server = new srp.SrpServer(srp.SRP.params[4096], verifier, Buffer.alloc(64, 9));
      const body = request.postDataJSON() as { srpA: string };
      server.setA(Buffer.from(body.srpA, "base64"));
      return fulfill({ sessionID: ids.session, srpB: b64(server.computeB()) });
    }
    if (request.method() === "POST" && url.pathname === "/users/srp/verify-session") {
      const body = request.postDataJSON() as { srpM1: string };
      server.checkM1(Buffer.from(body.srpM1, "base64"));
      return fulfill({
        srpM2: b64(server.computeM2()),
        id: 1,
        ...(options.requireTotp
          ? { twoFactorSessionID: ids.twoFactor }
          : { token: b64(Buffer.from(token)), keyAttributes }),
      });
    }
    if (request.method() === "POST" && url.pathname === "/users/two-factor/verify") {
      const body = request.postDataJSON() as unknown;
      if (JSON.stringify(body) !== JSON.stringify({ code: "123456", sessionID: ids.twoFactor }))
        throw new Error(`unexpected TOTP verify body: ${JSON.stringify(body)}`);
      return fulfill({ id: 1, encryptedToken, keyAttributes });
    }
    if (request.method() === "GET" && url.pathname === "/authenticator/key") {
      observedAuthToken = headers["x-auth-token"] ?? "missing";
      if (observedAuthToken !== expectedAuthToken)
        return fulfill({ observedToken: observedAuthToken }, 418);
      return fulfill(authenticatorKey);
    }
    if (request.method() === "GET" && url.pathname === "/authenticator/entity/diff") {
      if (headers["x-auth-token"] !== expectedAuthToken) throw new Error("unexpected auth token");
      const since = Number(url.searchParams.get("sinceTime"));
      if (!Number.isSafeInteger(since) || url.searchParams.get("limit") !== "2500")
        throw new Error(`unexpected diff query: ${key}`);
      return fulfill({
        diff: [...entities.values()].filter((entity) => entity.updatedAt > since),
        timestamp,
      });
    }
    if (request.method() === "POST" && url.pathname === "/authenticator/entity") {
      const body = request.postDataJSON() as { encryptedData: string; header: string };
      const id = `10000000-0000-4000-8000-${String(nextEntity++).padStart(12, "0")}`;
      timestamp += 1;
      const entity = {
        id,
        encryptedData: body.encryptedData,
        header: body.header,
        isDeleted: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      } satisfies MockEntity;
      entities.set(id, entity);
      mutationLog.push({ method: request.method(), path: url.pathname, body });
      if (failAfterCommit) {
        failAfterCommit = false;
        return route.abort("connectionreset");
      }
      return fulfill(entity);
    }
    if (request.method() === "PUT" && url.pathname === "/authenticator/entity") {
      const body = request.postDataJSON() as { id: string; encryptedData: string; header: string };
      const prior = entities.get(body.id);
      if (prior === undefined || prior.isDeleted) return fulfill({ error: "missing" }, 404);
      timestamp += 1;
      entities.set(body.id, { ...prior, ...body, updatedAt: timestamp });
      mutationLog.push({ method: request.method(), path: url.pathname, body });
      if (failAfterCommit) {
        failAfterCommit = false;
        return route.abort("connectionreset");
      }
      return route.fulfill({ status: 200, body: "" });
    }
    if (request.method() === "DELETE" && url.pathname === "/authenticator/entity") {
      const id = url.searchParams.get("id");
      const prior = id === null ? undefined : entities.get(id);
      if (id === null || prior === undefined) return fulfill({ error: "missing" }, 404);
      timestamp += 1;
      entities.set(id, {
        id,
        encryptedData: null,
        header: null,
        isDeleted: true,
        createdAt: prior.createdAt,
        updatedAt: timestamp,
      });
      mutationLog.push({
        method: request.method(),
        path: `${url.pathname}${url.search}`,
        body: null,
      });
      if (failAfterCommit) {
        failAfterCommit = false;
        return route.abort("connectionreset");
      }
      return route.fulfill({ status: 200, body: "" });
    }
    throw new Error(`unknown Ente endpoint: ${key}`);
  });
  const encryptProjection = (projection: OtpProjection) => {
    const init = sodium.crypto_secretstream_xchacha20poly1305_init_push(authKey);
    const plaintext = new TextEncoder().encode(canonicalJson(projection));
    try {
      return {
        encryptedData: b64(
          sodium.crypto_secretstream_xchacha20poly1305_push(
            init.state,
            plaintext,
            null,
            sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL,
          ),
        ),
        header: b64(init.header),
      };
    } finally {
      plaintext.fill(0);
    }
  };
  const changeRemote = (id: string, projection: OtpProjection | null) => {
    const prior = entities.get(id);
    if (prior === undefined) throw new Error(`missing mock entity ${id}`);
    // Advance beyond the last response cursor so deterministic out-of-band edits are observable.
    timestamp += 2;
    entities.set(
      id,
      projection === null
        ? { ...prior, encryptedData: null, header: null, isDeleted: true, updatedAt: timestamp }
        : {
            ...prior,
            ...encryptProjection(projection),
            isDeleted: false,
            updatedAt: timestamp,
          },
    );
  };
  return {
    requests,
    observations,
    mutationLog: () => mutationLog,
    mutations: () => mutationLog.length,
    entityIds: () => [...entities.keys()],
    entity: (id) => entities.get(id),
    remoteEdit: (id, projection) => changeRemote(id, projection),
    remoteDelete: (id) => changeRemote(id, null),
    failNextMutationAfterCommit: () => {
      failAfterCommit = true;
    },
  };
}

test("packaged Ente TOTP 2FA uses the exact verify route before key recovery and pull", async ({
  context,
  extensionId,
}) => {
  test.setTimeout(180_000);
  const mock = await installStrictMock(context, { requireTotp: true });
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/vault/index.html`);
  const vaultPassword = "local vault TOTP test password";
  await page.getByLabel("Master password", { exact: true }).fill(vaultPassword);
  await page.getByLabel("Confirm master password").fill(vaultPassword);
  await page.getByRole("button", { name: "Create vault" }).click();
  await expectVaultUnlocked(page);
  await openEnteSync(page);
  await page.getByRole("button", { name: "Connect Ente" }).click();
  await page.getByLabel("Ente email").fill(email);
  await page.getByLabel("Ente password").fill(password);
  await page.getByRole("button", { name: "Continue securely" }).click();
  const code = page.getByLabel("Ente two-factor code");
  await expect(code).toBeVisible({ timeout: 20_000 });
  expect(await page.getByLabel("Ente password").count()).toBe(0);
  await code.fill("123456");
  await page.getByRole("button", { name: "Verify code" }).click();
  await expect(page.getByRole("heading", { name: "Connected" })).toBeVisible({ timeout: 20_000 });
  expect(await code.count()).toBe(0);
  expect(mock.requests.slice(0, 7)).toEqual([
    `GET /users/srp/attributes?email=${encodeURIComponent(email)}`,
    "POST /users/srp/create-session",
    "POST /users/srp/verify-session",
    "POST /users/two-factor/verify",
    "GET /authenticator/key",
    "GET /authenticator/key",
    "GET /authenticator/entity/diff?sinceTime=0&limit=2500",
  ]);
  expect(mock.mutations()).toBe(0);
});

test("packaged Ente SRP login, key recovery, pull, lock and encrypted persistence matrix", async ({
  context,
  extensionId,
}) => {
  test.setTimeout(180_000);
  const mock = await installStrictMock(context);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/vault/index.html`);
  const vaultPassword = "local vault test password";
  await page.getByLabel("Master password", { exact: true }).fill(vaultPassword);
  await page.getByLabel("Confirm master password").fill(vaultPassword);
  await page.getByRole("button", { name: "Create vault" }).click();
  await expectVaultUnlocked(page);
  await openEnteSync(page);

  await page.getByRole("button", { name: "Connect Ente" }).click();
  await page.getByLabel("Ente email").fill(email);
  await page.getByLabel("Ente password").fill(password);
  expect(await page.getByLabel("Ente email").inputValue()).toBe(email);
  expect(await page.getByLabel("Ente password").inputValue()).toBe(password);
  await page.getByRole("button", { name: "Continue securely" }).click();
  await page.waitForTimeout(5_000);
  const workerDiagnostics = await page.evaluate(() => ({
    state: document.querySelector('[aria-label="Connect Ente"]')?.textContent ?? "missing",
    alert: document.querySelector('[role="alert"]')?.textContent ?? "none",
  }));
  await expect(page.getByRole("heading", { name: "Connected" }))
    .toBeVisible({ timeout: 20_000 })
    .catch(() => {
      throw new Error(
        `Ente connect failed after requests: ${mock.requests.join(" -> ")}; ${JSON.stringify(workerDiagnostics)}`,
      );
    });

  expect(mock.requests.slice(0, 6)).toEqual([
    `GET /users/srp/attributes?email=${encodeURIComponent(email)}`,
    "POST /users/srp/create-session",
    "POST /users/srp/verify-session",
    "GET /authenticator/key",
    "GET /authenticator/key",
    "GET /authenticator/entity/diff?sinceTime=0&limit=2500",
  ]);
  expect(mock.mutations()).toBe(0);
  expect(await page.getByLabel("Ente email").count()).toBe(0);
  expect(await page.getByLabel("Ente password").count()).toBe(0);

  const storage = await page.evaluate(() => chrome.storage.local.get(null));
  const serialized = JSON.stringify(storage);
  for (const canary of [password, token, b64(masterKeyCanary()), b64(authKeyCanary())])
    expect(serialized).not.toContain(canary);
  expect(serialized).not.toContain("encryptedSession");

  await page.setViewportSize({ width: 430, height: 760 });
  await stabilizePage(page);
  await expectNoSeriousAxeViolations(page);
  await expect(page).toHaveScreenshot("ente-mock-connected-compact.png", { fullPage: true });

  await createSyntheticOtp(page, "Queued create");
  await expect.poll(() => mock.mutations()).toBe(0);
  await page.getByRole("button", { name: "Sync now" }).click();
  await expect.poll(() => mock.mutations()).toBe(1);
  expect(mock.mutationLog().map(({ method, path }) => `${method} ${path}`)).toEqual([
    "POST /authenticator/entity",
  ]);
  await expect
    .poll(
      () =>
        mock.requests.filter((value) => value.startsWith("GET /authenticator/entity/diff")).length,
    )
    .toBeGreaterThanOrEqual(2);

  const afterMutation = JSON.stringify(await page.evaluate(() => chrome.storage.local.get(null)));
  for (const canary of [password, token, b64(masterKeyCanary()), b64(authKeyCanary())])
    expect(afterMutation).not.toContain(canary);

  const authToken = b64(Buffer.from(token));
  for (const observation of mock.observations) {
    expect(observation.accept).toBe("application/json");
    if (["POST", "PUT"].includes(observation.method))
      expect(observation.contentType).toBe("application/json");
    if (observation.path.startsWith("/authenticator/")) expect(observation.auth).toBe(authToken);
    else expect(observation.auth).toBeUndefined();
  }

  // Update is queued by the real editor, then dispatched and observed by a full pull.
  await page.getByRole("option", { name: /Synthetic matrix Queued create/u }).click();
  await expect(page.getByRole("heading", { name: "Edit one-time code" })).toBeVisible();
  await expect(page.getByLabel("Label")).toHaveValue("Queued create");
  await page.waitForTimeout(250);
  await page.getByLabel("Label").fill("Queued update");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("option", { name: /Synthetic matrix Queued update/u })).toBeVisible();
  await expect.poll(() => mock.mutations()).toBe(1);
  await page.getByRole("button", { name: "Sync now" }).click();
  await expect
    .poll(() => mock.mutations())
    .toBe(2)
    .catch(() => {
      throw new Error(`update did not dispatch: ${mock.requests.join(" -> ")}`);
    });
  expect(mock.mutationLog()[1]).toMatchObject({ method: "PUT", path: "/authenticator/entity" });
  await expect
    .poll(
      () =>
        mock.requests.filter(
          (value) => value === "GET /authenticator/entity/diff?sinceTime=0&limit=2500",
        ).length,
    )
    .toBeGreaterThanOrEqual(3);

  // Delete follows the same durable dispatch then remote-tombstone observation sequence.
  await page.getByRole("button", { name: "Delete OTP" }).click();
  await page.getByRole("button", { name: "Confirm delete" }).click();
  await expect.poll(() => page.getByRole("option", { name: /Queued update/u }).count()).toBe(0);
  await expect.poll(() => mock.mutations()).toBe(2);
  await page.getByRole("button", { name: "Sync now" }).click();
  await expect.poll(() => mock.mutations()).toBe(3);
  expect(mock.mutationLog()[2]?.method).toBe("DELETE");
  expect(mock.mutationLog()[2]?.path).toMatch(/^\/authenticator\/entity\?id=/u);

  // A real packaged chrome.alarms event invokes exactly one connected/unlocked sync callback.
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  const alarm = await worker.evaluate(async () => chrome.alarms.get("shardpass:ente-otp-sync:v1"));
  expect(alarm?.periodInMinutes).toBe(15);
  const beforeConnectedAlarmPulls = mock.requests.filter((value) =>
    value.includes("/authenticator/entity/diff"),
  ).length;
  await worker.evaluate(async () =>
    chrome.alarms.create("shardpass:ente-otp-sync:v1", { when: Date.now() + 30_000 }),
  );
  await expect
    .poll(
      () => mock.requests.filter((value) => value.includes("/authenticator/entity/diff")).length,
      { timeout: 40_000 },
    )
    .toBe(beforeConnectedAlarmPulls + 1);
  await page.waitForTimeout(750);
  expect(mock.requests.filter((value) => value.includes("/authenticator/entity/diff")).length).toBe(
    beforeConnectedAlarmPulls + 1,
  );

  // An uncertain committed create is reconciled from a full snapshot and is never duplicated.
  mock.failNextMutationAfterCommit();
  await createSyntheticOtp(page, "Uncertain create");
  await page.getByRole("button", { name: "Sync now" }).click();
  await expect.poll(() => mock.mutations()).toBe(4);
  await expect(page.getByRole("alert")).toContainText("could not complete");
  await page.reload();
  await expectVaultUnlocked(page);
  await openEnteSync(page);
  await page.getByRole("button", { name: "Sync now" }).click();
  await expect
    .poll(
      () =>
        mock.requests.filter(
          (value) => value === "GET /authenticator/entity/diff?sinceTime=0&limit=2500",
        ).length,
    )
    .toBeGreaterThanOrEqual(5);
  expect(mock.mutations()).toBe(4);

  // Local disconnect removes decrypted sync metadata through the real session-vault path, makes no
  // Ente request, preserves OTPs, and suppresses a stale real alarm event.
  const requestsBeforeDisconnect = mock.requests.length;
  await page.getByRole("button", { name: "Disconnect" }).click();
  await expect(page.getByRole("heading", { name: "Disconnect Ente sync?" })).toBeVisible();
  await page.getByRole("button", { name: "Confirm local disconnect" }).click();
  await expect(page.getByRole("heading", { name: "Disconnected" })).toBeVisible();
  expect(mock.requests).toHaveLength(requestsBeforeDisconnect);
  await expect(page.getByRole("option", { name: /Uncertain create/u })).toBeVisible();
  const safeDisconnectedState = await page.evaluate(async () => {
    const response: {
      state?: string;
      connected?: boolean;
      pendingCount?: number;
      conflictCount?: number;
      uncertainCount?: number;
    } = await chrome.runtime.sendMessage({ version: 1, kind: "ente.status" });
    return {
      state: response.state,
      connected: response.connected,
      pendingCount: response.pendingCount,
      conflictCount: response.conflictCount,
      uncertainCount: response.uncertainCount,
      keys: Object.keys(response).sort(),
    };
  });
  expect(safeDisconnectedState).toEqual({
    state: "disconnected",
    connected: false,
    pendingCount: 0,
    conflictCount: 0,
    uncertainCount: undefined,
    keys: [
      "conflictCount",
      "connected",
      "kind",
      "lastSuccessAt",
      "pendingCount",
      "state",
      "version",
    ],
  });
  expect(
    await worker.evaluate(async () => chrome.alarms.get("shardpass:ente-otp-sync:v1")),
  ).toBeUndefined();
  const beforeStaleAlarmPulls = mock.requests.filter((value) =>
    value.includes("/authenticator/entity/diff"),
  ).length;
  await worker.evaluate(async () =>
    chrome.alarms.create("shardpass:ente-otp-sync:v1", { when: Date.now() + 100 }),
  );
  await page.waitForTimeout(1_000);
  expect(mock.requests.filter((value) => value.includes("/authenticator/entity/diff")).length).toBe(
    beforeStaleAlarmPulls,
  );
});

type ConflictScenario = Readonly<{
  name: string;
  choice: "keep-local" | "keep-ente" | "keep-both";
  local: "edit" | "delete";
  remote: "edit" | "delete";
  expectedLabels: readonly string[];
}>;

const conflictScenarios: readonly ConflictScenario[] = [
  {
    name: "keep-local live queues L without a resolution request",
    choice: "keep-local",
    local: "edit",
    remote: "edit",
    expectedLabels: ["L"],
  },
  {
    name: "keep-ente live replaces the same local item with R without a resolution request",
    choice: "keep-ente",
    local: "edit",
    remote: "edit",
    expectedLabels: ["R"],
  },
  {
    name: "keep-both retains L and creates a local R identity without a resolution request",
    choice: "keep-both",
    local: "edit",
    remote: "edit",
    expectedLabels: ["L", "R"],
  },
  {
    name: "keep-local local deletion queues the remote delete and exposes no keep-both",
    choice: "keep-local",
    local: "delete",
    remote: "edit",
    expectedLabels: [],
  },
  {
    name: "keep-ente remote deletion removes the local item and exposes no keep-both",
    choice: "keep-ente",
    local: "edit",
    remote: "delete",
    expectedLabels: [],
  },
];

for (const scenario of conflictScenarios) {
  test(`packaged deterministic conflict: ${scenario.name}`, async ({
    context,
    extensionId,
  }, testInfo) => {
    test.setTimeout(180_000);
    const mock = await installStrictMock(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/vault/index.html`);
    const vaultPassword = `conflict-${scenario.choice}-${scenario.local}-${scenario.remote}`;
    await page.getByLabel("Master password", { exact: true }).fill(vaultPassword);
    await page.getByLabel("Confirm master password").fill(vaultPassword);
    await page.getByRole("button", { name: "Create vault" }).click();
    await expectVaultUnlocked(page);
    await openEnteSync(page);
    await openEnteSync(page);
    await page.getByRole("button", { name: "Connect Ente" }).click();
    await page.getByLabel("Ente email").fill(email);
    await page.getByLabel("Ente password").fill(password);
    await page.getByRole("button", { name: "Continue securely" }).click();
    await expect(page.getByRole("heading", { name: "Connected" })).toBeVisible({ timeout: 20_000 });

    await createSyntheticOtp(page, "B");
    await page.getByRole("button", { name: "Sync now" }).click();
    await expect.poll(() => mock.mutations()).toBe(1);
    const [remoteId] = mock.entityIds();
    expect(remoteId).toBeDefined();

    if (scenario.local === "edit") {
      await page.getByLabel("Label").fill("L");
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect(page.getByRole("option", { name: /Synthetic matrix L/u })).toBeVisible();
    } else {
      await page.getByRole("button", { name: "Delete OTP" }).click();
      await page.getByRole("button", { name: "Confirm delete" }).click();
      await expect
        .poll(() => page.getByRole("option", { name: /Synthetic matrix B/u }).count())
        .toBe(0);
    }
    const remoteProjection: OtpProjection = {
      version: 1,
      kind: "otp",
      otpType: "totp",
      issuer: "Synthetic matrix",
      label: "R",
      secretBase32: "JBSWY3DPEHPK3PXP",
      algorithm: "SHA1",
      digits: 6,
      period: 30,
    };
    if (scenario.remote === "edit") mock.remoteEdit(remoteId!, remoteProjection);
    else mock.remoteDelete(remoteId!);
    await page.waitForTimeout(500);

    const refreshResponse: unknown = await page.evaluate(() =>
      Promise.resolve(
        chrome.runtime.sendMessage({ version: 1, kind: "ente.manualSync" }) as unknown,
      ),
    );
    if ((refreshResponse as { kind?: string }).kind === "error")
      throw new Error(`manual conflict refresh: ${JSON.stringify(refreshResponse)}`);
    await page.reload();
    await expectVaultUnlocked(page);
    await openEnteSync(page);
    await openEnteSync(page);
    await expect(page.getByRole("heading", { name: "Conflicts require review" }))
      .toBeVisible()
      .catch(async () => {
        throw new Error(
          `conflict refresh failed: ${mock.requests.join(" -> ")}; alert=${await page.getByRole("alert").textContent()}`,
        );
      });
    expect(mock.mutations()).toBe(1);
    const keepBoth = page.getByRole("radio", { name: /Keep both/u });
    if (scenario.local === "delete" || scenario.remote === "delete")
      await expect(keepBoth).toBeDisabled();
    else await expect(keepBoth).toBeEnabled();

    const choiceName =
      scenario.choice === "keep-local"
        ? /Keep this device/u
        : scenario.choice === "keep-ente"
          ? /Keep Ente/u
          : /Keep both/u;
    await page.getByRole("radio", { name: choiceName }).check();
    await page.getByRole("button", { name: "Apply explicit choice" }).click();
    await expect(page.getByRole("heading", { name: "Connected" })).toBeVisible();
    expect(mock.mutationLog().map(({ method }) => method)).toEqual(["POST"]);
    await page.reload();
    await expectVaultUnlocked(page);
    await openEnteSync(page);
    await openEnteSync(page);

    for (const label of ["B", "L", "R"])
      await expect(
        page.getByRole("option", { name: new RegExp(`Synthetic matrix ${label}`, "u") }),
      ).toHaveCount(scenario.expectedLabels.includes(label) ? 1 : 0);
    const safeState: unknown = await page.evaluate(() =>
      Promise.resolve(chrome.runtime.sendMessage({ version: 1, kind: "ente.status" }) as unknown),
    );
    expect(safeState).toMatchObject({
      state: "idle",
      pendingCount: 0,
      conflictCount: 0,
      conflicts: [],
    });
    expect(mock.mutationLog().filter(({ method }) => method === "POST")).toHaveLength(1);
    expect(mock.mutationLog().filter(({ method }) => method === "PUT")).toHaveLength(0);
    expect(mock.mutationLog().filter(({ method }) => method === "DELETE")).toHaveLength(0);
    await testInfo.attach("resolved-conflict", {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
  });
}

async function createSyntheticOtp(page: Page, label: string): Promise<void> {
  await page.getByRole("button", { name: /^New item/ }).click();
  await page.getByRole("menuitem", { name: "One-time code" }).click();
  await page.getByLabel("Issuer").fill("Synthetic matrix");
  await page.getByLabel("Label").fill(label);
  // Creating a code shows the secret field outright; only editing starts concealed.
  await page.locator("#otp-secret").fill("JBSWY3DPEHPK3PXP");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  // Saving selects the new code and shows its detail, titled by the issuer.
  await expect(page.getByRole("heading", { name: "Synthetic matrix", level: 2 })).toBeVisible();
}

function masterKeyCanary(): Uint8Array {
  return new Uint8Array(32).fill(10);
}
function authKeyCanary(): Uint8Array {
  return new Uint8Array(32).fill(11);
}
