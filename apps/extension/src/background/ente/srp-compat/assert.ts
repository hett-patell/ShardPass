function strictEqual<T>(actual: T, expected: T): void {
  if (actual !== expected) throw new Error("Assertion failed");
}

export default { strictEqual };
