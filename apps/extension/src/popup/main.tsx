import "@shardpass/ui/styles";

import { AppErrorBoundary, applyThemePreference } from "@shardpass/ui";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { createChromePlatform } from "../platform/chrome-platform";
import { reloadWhenContextInvalidated } from "../platform/extension-context";
import { PopupApp } from "./PopupApp";

const rootElement = document.querySelector<HTMLElement>("#root");

if (rootElement === null) {
  throw new Error("Popup root element is missing.");
}

// Before first paint, so a stored dark/light choice never flashes the other theme.
applyThemePreference();

const platform = createChromePlatform();
reloadWhenContextInvalidated();

createRoot(rootElement).render(
  <StrictMode>
    <AppErrorBoundary surface="the popup">
      <PopupApp platform={platform} />
    </AppErrorBoundary>
  </StrictMode>,
);
