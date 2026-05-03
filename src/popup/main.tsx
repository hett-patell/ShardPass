import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { log } from "@/lib/log";
import "./globals.css";

log("popup", "boot at", new Date().toISOString());

document.addEventListener("visibilitychange", () => {
  log("popup", `visibility: ${document.visibilityState}`);
});
window.addEventListener("blur", () => log("popup", "blur"));
window.addEventListener("focus", () => log("popup", "focus"));
window.addEventListener("pagehide", (e) =>
  log("popup", `pagehide persisted=${e.persisted}`),
);
window.addEventListener("beforeunload", () => log("popup", "beforeunload"));
window.addEventListener("unload", () => log("popup", "unload"));

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
