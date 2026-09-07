import "@shardpass/ui/styles";
import { applyThemePreference } from "@shardpass/ui";
import { createRoot } from "react-dom/client";

import { PopupApp } from "../../src/popup/PopupApp";
import { createScriptedPlatform, type Scenario } from "./scripted-platform";

const params = new URLSearchParams(location.search);
const scenario = (params.get("scenario") ?? "unlocked") as Scenario;
applyThemePreference(params.get("theme") === "light" ? "light" : "dark");
const platform = createScriptedPlatform({ tabUrl: params.get("tab") ?? "https://github.com/login", scenario });
createRoot(document.getElementById("root")!).render(<PopupApp platform={platform} />);
