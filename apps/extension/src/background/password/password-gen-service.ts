import { generatePassphrase, generateRandomPassword } from "@shardpass/crypto/password-generator";
import {
  GeneratePasswordRequestSchema,
  GeneratePasswordResponseSchema,
  type GeneratePasswordRequest,
  type GeneratePasswordResponse,
} from "@shardpass/messaging";

export type PasswordGenServiceErrorCode = "PASSWORD_GEN_INVALID";

export class PasswordGenServiceError extends Error {
  constructor(readonly code: PasswordGenServiceErrorCode) {
    super(code);
    this.name = "PasswordGenServiceError";
  }
}

export class PasswordGenService {
  // Async to match the handle(request): Promise<Response> shape every other background
  // service exposes to the router, even though generation itself is synchronous.
  // eslint-disable-next-line @typescript-eslint/require-await
  async handle(request: GeneratePasswordRequest): Promise<GeneratePasswordResponse> {
    const parsed = GeneratePasswordRequestSchema.safeParse(request);
    if (!parsed.success) throw new PasswordGenServiceError("PASSWORD_GEN_INVALID");
    const command = parsed.data;
    try {
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
      const response = {
        version: 1 as const,
        kind: "password.generateResult" as const,
        password: generated.password,
        entropyBits: generated.entropyBits,
      };
      const validated = GeneratePasswordResponseSchema.safeParse(response);
      if (!validated.success) throw new PasswordGenServiceError("PASSWORD_GEN_INVALID");
      return Object.freeze(validated.data);
    } catch (error) {
      if (error instanceof PasswordGenServiceError) throw error;
      throw new PasswordGenServiceError("PASSWORD_GEN_INVALID");
    }
  }
}
