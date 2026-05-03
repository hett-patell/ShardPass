const TAG = "[ShardPass]";

function fmt(scope: string): string {
  return `${TAG}[${scope}]`;
}

export function log(scope: string, ...args: unknown[]): void {
  // eslint-disable-next-line no-console
  console.log(fmt(scope), ...args);
}

export function warn(scope: string, ...args: unknown[]): void {
  // eslint-disable-next-line no-console
  console.warn(fmt(scope), ...args);
}

export function error(scope: string, ...args: unknown[]): void {
  // eslint-disable-next-line no-console
  console.error(fmt(scope), ...args);
}

export function group(scope: string, label: string): () => void {
  const full = `${fmt(scope)} ${label}`;
  // eslint-disable-next-line no-console
  console.groupCollapsed(full);
  return () => {
    // eslint-disable-next-line no-console
    console.groupEnd();
  };
}
