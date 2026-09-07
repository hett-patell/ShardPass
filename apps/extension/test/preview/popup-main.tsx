import "@shardpass/ui/styles";
import { applyThemePreference } from "@shardpass/ui";
import { createRoot } from "react-dom/client";

import { PopupApp } from "../../src/popup/PopupApp";
import { createScriptedPlatform } from "./scripted-platform";

const params = new URLSearchParams(location.search);
applyThemePreference(params.get("theme") === "light" ? "light" : "dark");
const platform = createScriptedPlatform({ tabUrl: params.get("tab") ?? "https://github.com/login" });
createRoot(document.getElementById("root")!).render(<PopupApp platform={platform} />);
