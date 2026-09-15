/**
 * Items whose master-password re-prompt has been answered recently. A grant is per item
 * and short-lived; the lock clears every one. Held in the worker only: a page proves the
 * password to the background and the background remembers, so no page can grant itself.
 */
export class RepromptGrants {
  private readonly grants = new Map<string, number>();

  constructor(
    private readonly now: () => number,
    private readonly ttlMs = 5 * 60_000,
  ) {}

  grant(itemId: string): void {
    this.grants.set(itemId, this.now() + this.ttlMs);
  }

  granted(itemId: string): boolean {
    const until = this.grants.get(itemId);
    if (until === undefined) return false;
    if (until <= this.now()) {
      this.grants.delete(itemId);
      return false;
    }
    return true;
  }

  clear(): void {
    this.grants.clear();
  }
}
