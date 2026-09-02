import "@shardpass/ui/styles";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { createChromePlatform } from "../platform/chrome-platform";
import { PopupApp } from "./PopupApp";

const rootElement = document.querySelector<HTMLElement>("#root");

if (rootElement === null) {
  throw new Error("Popup root element is missing.");
}

const platform = createChromePlatform();

createRoot(rootElement).render(
  <StrictMode>
    <PopupApp platform={platform} />
  </StrictMode>,
);
