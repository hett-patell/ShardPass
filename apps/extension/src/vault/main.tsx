import "@shardpass/ui/styles";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { createChromePlatform } from "../platform/chrome-platform";
import { VaultApp } from "./VaultApp";

const rootElement = document.querySelector<HTMLElement>("#root");

if (rootElement === null) {
  throw new Error("Vault root element is missing.");
}

const platform = createChromePlatform();

createRoot(rootElement).render(
  <StrictMode>
    <VaultApp platform={platform} />
  </StrictMode>,
);
