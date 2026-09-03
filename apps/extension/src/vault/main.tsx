import "@shardpass/ui/styles";

import { applyThemePreference } from "@shardpass/ui";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { createChromePlatform } from "../platform/chrome-platform";
import { VaultApp } from "./VaultApp";

const rootElement = document.querySelector<HTMLElement>("#root");

if (rootElement === null) {
  throw new Error("Vault root element is missing.");
}

// Before first paint, so a stored dark/light choice never flashes the other theme.
applyThemePreference();

const platform = createChromePlatform();

createRoot(rootElement).render(
  <StrictMode>
    <VaultApp platform={platform} />
  </StrictMode>,
);
