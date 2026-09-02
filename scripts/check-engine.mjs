const allowNode24 = process.argv.includes("--allow-node24");
const localCommandArgument = process.argv.find((argument) =>
  argument.startsWith("--local-command="),
);
const requestedLocalCommand = localCommandArgument?.slice("--local-command=".length);
const allowedLocalCommands = new Set([
  "verify:project0:local-node24",
  "verify:project1:task8:local-node24",
  "verify:project1:task9:local-node24",
  "verify:project1:task10:local-node24",
  "verify:project1:task11:local-node24",
  "verify:project1:task12:local-node24",
  "verify:project1:local-node24",
]);
const requirementByLocalCommand = new Map([
  ["verify:project0:local-node24", "Project 0"],
  ["verify:project1:task8:local-node24", "Project 0"],
  ["verify:project1:task9:local-node24", "Project 1 Task 9"],
  ["verify:project1:task10:local-node24", "Project 1 Task 10"],
  ["verify:project1:task11:local-node24", "Project 1 Task 11"],
  ["verify:project1:task12:local-node24", "Project 1 Task 12"],
  ["verify:project1:local-node24", "Project 1"],
]);

if (requestedLocalCommand !== undefined && !allowedLocalCommands.has(requestedLocalCommand)) {
  console.error("Invalid local verification command.");
  process.exitCode = 1;
} else {
  const localCommand = requestedLocalCommand ?? "verify:project0:local-node24";
  const requirement = requirementByLocalCommand.get(localCommand);
  const [major, minor] = process.versions.node.split(".").map(Number);
  const pnpmVersion =
    /^pnpm\/([^\s]+)/u.exec(process.env.npm_config_user_agent ?? "")?.[1] ?? "unknown";
  const officialNode = major === 22 && minor >= 14;
  const localNode24 = allowNode24 && major === 24;

  if ((!officialNode && !localNode24) || pnpmVersion !== "10.14.0") {
    console.error(
      `${requirement} requires Node >=22.14.0 <23 and pnpm 10.14.0; found Node ${process.versions.node} and pnpm ${pnpmVersion}.` +
        (allowNode24
          ? " The local bypass permits Node 24 only."
          : ` Use ${localCommand} for development evidence only.`),
    );
    process.exitCode = 1;
  } else if (localNode24) {
    console.warn(
      `Development-only runtime bypass: Node ${process.versions.node}. This does not clear the official Node 22 release blocker.`,
    );
  } else {
    console.log(`Approved runtime verified: Node ${process.versions.node}, pnpm ${pnpmVersion}.`);
  }
}
