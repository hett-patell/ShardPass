import "@shardpass/ui/styles";
import { applyThemePreference } from "@shardpass/ui";
import { createRoot } from "react-dom/client";

import { VaultApp } from "../../src/vault/VaultApp";
import { createScriptedPlatform } from "./scripted-platform";

const params = new URLSearchParams(location.search);
applyThemePreference(params.get("theme") === "light" ? "light" : "dark");
createRoot(document.getElementById("root")!).render(<VaultApp platform={createScriptedPlatform()} />);
