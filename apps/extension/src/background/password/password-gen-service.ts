import { generatePassphrase, generateRandomPassword, generateUsername } from "@shardpass/crypto";
import {
  PasswordGenRequestSchema,
  PasswordGenResponseSchema,
  type GeneratePasswordRequest,
  type GenerateUsernameRequest,
  type PasswordGenRequest,
  type PasswordGenResponse,
} from "@shardpass/messaging";
import type { StoragePort } from "@shardpass/storage";

export type PasswordGenServiceErrorCode = "PASSWORD_GEN_INVALID";

export class PasswordGenServiceError extends Error {
  constructor(readonly code: PasswordGenServiceErrorCode) {
    super(code);
    this.name = "PasswordGenServiceError";
  }
}

const SETTINGS_KEY = "shardpass:v1:generator-settings";

type GeneratorSettings = Readonly<{ email: string; domain: string }>;
type PasswordGenDependencies = Readonly<{
  /** Non-secret preferences (the plus-address and catch-all domain); local so they survive a restart. */
  local?: StoragePort;
}>;

export class PasswordGenService {
  constructor(private readonly dependencies: PasswordGenDependencies = {}) {}

  async handle(request: PasswordGenRequest): Promise<PasswordGenResponse> {
    const parsed = PasswordGenRequestSchema.safeParse(request);
    if (!parsed.success) throw new PasswordGenServiceError("PASSWORD_GEN_INVALID");
    const command = parsed.data;
    try {
      let response: PasswordGenResponse;
      switch (command.kind) {
        case "password.generate":
          response = generatePasswordResponse(command);
          break;
        case "password.generateUsername":
          response = await this.generateUsernameResponse(command);
          break;
        case "password.getGeneratorSettings":
          response = { version: 1, kind: "password.generatorSettings", ...(await this.settings()) };
          break;
        case "password.setGeneratorSettings": {
          const next = { email: command.email.trim(), domain: command.domain.trim() };
          await this.dependencies.local?.set({ [SETTINGS_KEY]: { version: 1, ...next } });
          response = { version: 1, kind: "password.generatorSettings", ...next };
          break;
        }
      }
      const validated = PasswordGenResponseSchema.safeParse(response);
      if (!validated.success) throw new PasswordGenServiceError("PASSWORD_GEN_INVALID");
      return Object.freeze(validated.data);
    } catch (error) {
      if (error instanceof PasswordGenServiceError) throw error;
      throw new PasswordGenServiceError("PASSWORD_GEN_INVALID");
    }
  }

  /**
   * What a sign-up form on `host` is offered: a plus-address when one is configured, else a
   * catch-all address, else a word name. Never throws; the picker simply shows nothing.
   */
  async suggestForSite(host: string): Promise<string | null> {
    try {
      const settings = await this.settings();
      const kind = settings.email !== "" ? "plus" : settings.domain !== "" ? "catchall" : "word";
      return generateUsername({ kind, site: host, ...settings }).username;
    } catch {
      return null;
    }
  }

  private async generateUsernameResponse(
    command: GenerateUsernameRequest,
  ): Promise<PasswordGenResponse> {
    const settings = await this.settings();
    const generated = generateUsername({
      kind: command.usernameKind,
      email: command.email ?? settings.email,
      domain: command.domain ?? settings.domain,
      ...(command.site === undefined ? {} : { site: command.site }),
      ...(command.length === undefined ? {} : { length: command.length }),
      ...(command.number === undefined ? {} : { number: command.number }),
      ...(command.capitalize === undefined ? {} : { capitalize: command.capitalize }),
    });
    return {
      version: 1,
      kind: "password.generateUsernameResult",
      username: generated.username,
      entropyBits: generated.entropyBits,
    };
  }

  private async settings(): Promise<GeneratorSettings> {
    try {
      const stored = (await this.dependencies.local?.get([SETTINGS_KEY]))?.[SETTINGS_KEY];
      if (typeof stored !== "object" || stored === null) return { email: "", domain: "" };
      const record = stored as { email?: unknown; domain?: unknown };
      return {
        email: typeof record.email === "string" ? record.email : "",
        domain: typeof record.domain === "string" ? record.domain : "",
      };
    } catch {
      return { email: "", domain: "" };
    }
  }
}

function generatePasswordResponse(command: GeneratePasswordRequest): PasswordGenResponse {
  const generated =
    command.mode === "random"
      ? generateRandomPassword({
          ...(command.length === undefined ? {} : { length: command.length }),
          ...(command.uppercase === undefined ? {} : { uppercase: command.uppercase }),
          ...(command.lowercase === undefined ? {} : { lowercase: command.lowercase }),
          ...(command.digits === undefined ? {} : { digits: command.digits }),
          ...(command.symbols === undefined ? {} : { symbols: command.symbols }),
          ...(command.excludeAmbiguous === undefined
            ? {}
            : { excludeAmbiguous: command.excludeAmbiguous }),
        })
      : generatePassphrase({
          ...(command.wordCount === undefined ? {} : { wordCount: command.wordCount }),
          ...(command.separator === undefined ? {} : { separator: command.separator }),
          ...(command.capitalize === undefined ? {} : { capitalize: command.capitalize }),
        });
  return {
    version: 1,
    kind: "password.generateResult",
    password: generated.password,
    entropyBits: generated.entropyBits,
  };
}
