import "@shardpass/ui/styles";

import { AppErrorBoundary, applyThemePreference } from "@shardpass/ui";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { createChromePlatform } from "../platform/chrome-platform";
import { diagnostics } from "../platform/diagnostics";
import { reloadWhenContextInvalidated } from "../platform/extension-context";
import { VaultApp } from "./VaultApp";

const rootElement = document.querySelector<HTMLElement>("#root");

if (rootElement === null) {
  throw new Error("Vault root element is missing.");
}

// Before first paint, so a stored dark/light choice never flashes the other theme.
applyThemePreference();

const platform = createChromePlatform();
reloadWhenContextInvalidated();

createRoot(rootElement).render(
  <StrictMode>
    <AppErrorBoundary
      surface="the vault page"
      onError={(error) => diagnostics.error("[ShardPass] A page failed to render.", error)}
    >
      <VaultApp platform={platform} />
    </AppErrorBoundary>
  </StrictMode>,
);
