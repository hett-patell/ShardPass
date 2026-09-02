import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { verifyTask12ReleaseEvidence } from "./task12-release-evidence.mjs";

const localGate = spawnSync("pnpm", ["verify:project1:task12:evidence"], {
  cwd: new URL("..", import.meta.url),
  encoding: "utf8",
  stdio: "inherit",
});
if (localGate.status !== 0) {
  process.stderr.write("Task 12 release blocked: local evidence gate failed\n");
  process.exit(localGate.status ?? 1);
}

const trustStorePath = process.env.TASK12_REVIEWER_TRUST_STORE;
const requiredNode = /^v22\./u;
const requiredPnpm = "10.14.0";
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const { failures } = await verifyTask12ReleaseEvidence({
  ledgerPath: new URL("../.sdd/project1-task12-execution-ledger.md", import.meta.url),
  distPath: new URL("../dist", import.meta.url),
  chromeEvidencePath: new URL("../.sdd/project1-task12-chrome110-evidence.json", import.meta.url),
  finalEvidencePath: new URL("../.sdd/project1-task12-final-disposition.json", import.meta.url),
  trustStorePath,
});
if (!requiredNode.test(process.version))
  failures.unshift(`official Node 22 process is required; actual ${process.version}`);
if (packageJson.packageManager !== `pnpm@${requiredPnpm}`) failures.push("pnpm exact pin drifted");
if (failures.length > 0) {
  for (const failure of failures) process.stderr.write(`Task 12 release blocked: ${failure}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("Task 12 release evidence verified.\n");
}
