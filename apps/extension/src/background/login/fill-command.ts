import type { LoginFillSuggestion } from "@shardpass/messaging";

export type FillCommandTab = Readonly<{ id: number; url: string }>;

type FillCommandDependencies = Readonly<{
  activeTab(): Promise<FillCommandTab | null>;
  suggestionsFor(pageUrl: string): Promise<readonly LoginFillSuggestion[]>;
  /** Asks the tab's content script to fill; resolves with its status. */
  fillInTab(tabId: number, itemId: string, expectedRevision: number): Promise<unknown>;
  openPopup(): Promise<void>;
}>;

/**
 * The keyboard command and the context-menu entry: fill the one login saved for the page
 * without opening anything. With several matches, none, a locked vault or a login that asks
 * for the master password first, the popup opens instead, where each of those is handled.
 */
export function createFillCommand(dependencies: FillCommandDependencies) {
  return {
    async run(tab: FillCommandTab | null = null): Promise<"filled" | "popup" | "nothing"> {
      const target = tab ?? (await dependencies.activeTab());
      if (target === null || !/^https?:/u.test(target.url)) return "nothing";
      let candidates: readonly LoginFillSuggestion[];
      try {
        candidates = (await dependencies.suggestionsFor(target.url)).filter(
          (suggestion) => suggestion.reprompt !== true && suggestion.signInWith === undefined,
        );
      } catch {
        await dependencies.openPopup();
        return "popup";
      }
      const only = candidates.length === 1 ? candidates[0] : undefined;
      if (only === undefined) {
        await dependencies.openPopup();
        return "popup";
      }
      const outcome = (await dependencies
        .fillInTab(target.id, only.itemId, only.expectedRevision)
        .catch(() => undefined)) as { status?: unknown } | undefined;
      if (outcome?.status === "filled") return "filled";
      await dependencies.openPopup();
      return "popup";
    },
  };
}
