/* Scripted platform for visual previews: unlocked vault, sample items, live codes. Not shipped. */
import type { VaultItem } from "@shardpass/domain";
import type { EnteSafeState, OtpRequest, OtpResponse } from "@shardpass/messaging";

const stamp = "2026-08-10T12:00:00.000Z";
const base = { schemaVersion: 2 as const, revision: 1, createdAt: stamp, updatedAt: stamp, favorite: false, tags: [] as string[] };
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const items: VaultItem[] = [
  { ...base, id: id(1), kind: "login", name: "GitHub", username: "octocat", password: "correct horse battery staple", urls: ["https://github.com/login"], notes: "Work account. Recovery codes in the safe.", favorite: true, tags: ["work"], totp: "JBSWY3DPEHPK3PXP" },
  { ...base, id: id(2), kind: "login", name: "Google", username: "het@example.com", password: "p4ssw0rd-google", urls: ["https://accounts.google.com"], notes: "" },
  { ...base, id: id(3), kind: "login", name: "AWS Console", username: "het-admin", password: "aws-secret-9", urls: ["https://console.aws.amazon.com"], notes: "", tags: ["work", "infra"] },
  { ...base, id: id(4), kind: "login", name: "Proton Mail", username: "het@proton.me", password: "proton-pass", urls: ["https://account.proton.me"], notes: "" },
  { ...base, id: id(11), kind: "otp", issuer: "GitHub", label: "octocat", secret: "JBSWY3DPEHPK3PXP", otpType: "totp", algorithm: "SHA1", digits: 6, period: 30, note: "", favorite: true },
  { ...base, id: id(12), kind: "otp", issuer: "Proton", label: "het@proton.me", secret: "GEZDGNBVGY3TQOJQ", otpType: "totp", algorithm: "SHA1", digits: 6, period: 30, note: "" },
  { ...base, id: id(21), kind: "note", name: "Home Wi-Fi", content: "SSID: Bramble\nPassword: sunflower-42\n\nGuest network is open on weekends.", tags: ["home"] },
  { ...base, id: id(31), kind: "card", name: "Visa · personal", cardholderName: "HET PATEL", number: "4111111111111111", expMonth: "09", expYear: "2029", cvv: "123", pin: "", notes: "", brand: "visa" },
  { ...base, id: id(41), kind: "identity", name: "Het Patel", firstName: "Het", lastName: "Patel", email: "het@example.com", phone: "+91 98765 43210", street: "12 Bramble Lane", city: "Ahmedabad", state: "Gujarat", zip: "380001", country: "India", notes: "" },
  { ...base, id: id(51), kind: "secret", name: "Deploy token", secretType: "api_key", value: "sk-live-9f2c8a7b1d", notes: "", metadata: {} },
] as unknown as VaultItem[];

const projection = (item: VaultItem) => ({
  id: item.id,
  kind: item.kind,
  revision: item.revision,
  name: item.kind === "otp" ? item.issuer : item.name,
  subtitle: item.kind === "otp" ? item.label : item.kind === "login" ? item.username : item.kind === "note" ? "SSID: Bramble" : item.kind === "card" ? "•••• 1111" : item.kind === "secret" ? "API key" : undefined,
  favorite: item.favorite,
  tags: item.tags,
  ...(item.kind === "login" ? { urls: item.urls } : {}),
});

const state = (sequence: number) => ({
  version: 1, kind: "vault.state", state: "unlocked", autoLockMinutes: 15, lockOnScreenLock: true, retryAfterMs: 0,
  streamId: "00000000000000000000000000000001", sequence,
});

export function createScriptedPlatform(options: { tabUrl?: string } = {}) {
  let sequence = 1;
  const listeners = new Set<(state: unknown) => void>();
  return {
    extensionId: "preview",
    onMessage: () => () => undefined,
    connectVaultState(onState: (state: unknown) => void) {
      listeners.add(onState);
      setTimeout(() => onState(state(sequence++)), 0);
      return () => listeners.delete(onState);
    },
    sendMessage(payload: unknown): Promise<unknown> {
      const request = payload as { kind?: string; itemId?: string; search?: string; itemKind?: string };
      switch (request.kind) {
        case "foundation.getStatus":
          return Promise.resolve({ version: 1, kind: "foundation.status", phase: "foundation", vaultAvailable: false });
        case "vault.getState":
          return Promise.resolve(state(sequence++));
        case "item.list":
          return Promise.resolve({ version: 1, kind: "item.listResult", items: items.map(projection) });
        case "item.query":
          return Promise.resolve({ version: 1, kind: "item.queryResult", items });
        case "item.get":
          return Promise.resolve({ version: 1, kind: "item.getResult", item: items.find((item) => item.id === request.itemId) });
        case "login.reveal":
          return Promise.resolve({ version: 1, kind: "login.fillRelease", username: "octocat", password: "correct horse battery staple" });
        case "folder.list":
          return Promise.resolve({ version: 1, kind: "folder.listResult", folders: [
            { id: id(901), name: "Work" }, { id: id(902), name: "Clients", parentId: id(901) }, { id: id(903), name: "Home" },
          ] });
        case "vault.lock":
          return Promise.resolve({ version: 1, kind: "vault.ok", state: "locked", committed: true });
        case "migration.inspect":
          return Promise.resolve({ version: 1, kind: "migration.status", available: false, phase: "none", itemCount: 0 });
        default:
          return Promise.resolve(undefined);
      }
    },
    sendOtpMessage(request: OtpRequest): Promise<OtpResponse> {
      if (request.kind === "otp.getCode" || request.kind === "otp.copyCode") {
        const now = Date.now();
        const period = 30_000;
        const expiresAt = Math.ceil(now / period) * period;
        return Promise.resolve({ version: 1, kind: "otp.codeResult", itemId: (request as { itemId: string }).itemId, revision: 1, code: "482913", otpType: "totp", period: 30, remaining: Math.ceil((expiresAt - now) / 1000), expiresAt } as OtpResponse);
      }
      if (request.kind === "otp.list") return Promise.resolve({ version: 1, kind: "otp.listResult", items: [] } as OtpResponse);
      return Promise.reject(new Error("unused"));
    },
    sendEnteMessage(): Promise<EnteSafeState> {
      return Promise.resolve({ version: 1, kind: "ente.state", state: "disconnected", connected: false, pendingCount: 0, conflictCount: 0, lastSuccessAt: null });
    },
    sendBackupMessage: () => Promise.reject(new Error("unused")),
    sendOtpImportMessage: () => Promise.reject(new Error("unused")),
    writeAuthoritativeClipboardText: (value: Promise<string>) => value.then(() => undefined),
    openVaultPage: () => Promise.resolve(),
    activeTab: () => Promise.resolve(options.tabUrl === undefined ? null : { id: 1, url: options.tabUrl }),
    sendToTab: () => Promise.resolve({ version: 1, kind: "login.fillFromPopupResult", status: "filled" }),
  };
}
