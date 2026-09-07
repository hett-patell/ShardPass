/**
 * Times for people: relative when recent ("3 minutes ago", "in 12 minutes"), the local date
 * and time otherwise, and always the exact local time in `title` for a hover.
 */
export function formatWhen(
  value: number | null | undefined,
  now: number = Date.now(),
): { text: string; title: string } {
  if (value === null || value === undefined) return { text: "Not yet", title: "" };
  const date = new Date(value);
  const title = date.toLocaleString();
  const delta = value - now;
  const abs = Math.abs(delta);
  const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  let text: string;
  if (abs < 45_000) text = delta <= 0 ? "just now" : "in a moment";
  else if (abs < 60 * 60_000) text = phrase(delta, unit(Math.round(abs / 60_000), "minute"));
  else if (abs < 24 * 60 * 60_000) text = phrase(delta, unit(Math.round(abs / 3_600_000), "hour"));
  else text = date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  return { text, title };
}

function phrase(delta: number, span: string): string {
  return delta <= 0 ? `${span} ago` : `in ${span}`;
}
