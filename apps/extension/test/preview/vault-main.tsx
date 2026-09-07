import "@shardpass/ui/styles";
import { applyThemePreference } from "@shardpass/ui";
import { createRoot } from "react-dom/client";

import { VaultApp } from "../../src/vault/VaultApp";
import { createScriptedPlatform, type Scenario } from "./scripted-platform";

const params = new URLSearchParams(location.search);
const scenario = (params.get("scenario") ?? "unlocked") as Scenario;
applyThemePreference(params.get("theme") === "light" ? "light" : "dark");
createRoot(document.getElementById("root")!).render(<VaultApp platform={createScriptedPlatform({ scenario })} />);
