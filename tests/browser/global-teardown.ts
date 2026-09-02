import { rm } from "node:fs/promises";

export default async function globalTeardown(): Promise<void> {
  await rm(new URL("../../.test-dist", import.meta.url), { recursive: true, force: true });
}
