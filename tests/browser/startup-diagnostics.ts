const fatalPattern = /\[(?:\d+):(?:\d+):FATAL:([^:(]+)(?:\([^)]*\))?\]/u;
const errorPattern = /\[(?:\d+):(?:\d+):ERROR:([^:(]+)(?:\([^)]*\))?\]/u;

const exactBenignErrorSources = new Set(["object_proxy.cc"]);

export function classifyChromiumStartupStderr(stderr: string): string[] {
  const findings: string[] = [];
  for (const line of stderr.split(/\r?\n/u)) {
    const fatal = fatalPattern.exec(line);
    if (fatal?.[1] !== undefined) {
      findings.push(`[FATAL:${fatal[1]}]`);
      continue;
    }
    const error = errorPattern.exec(line);
    if (error?.[1] !== undefined && !exactBenignErrorSources.has(error[1])) {
      findings.push(`[ERROR:${error[1]}]`);
    }
  }
  return findings;
}
