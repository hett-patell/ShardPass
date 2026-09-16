import { describe, expect, it } from "vitest";

import { formatWhen } from "../../src/vault/format-time";

const now = Date.UTC(2026, 8, 7, 7, 13, 0);
const minute = 60_000;

describe("formatWhen", () => {
  it("says Not yet for an absent time", () => {
    expect(formatWhen(undefined, now)).toEqual({ text: "Not yet", title: "" });
    expect(formatWhen(null, now).text).toBe("Not yet");
  });

  it("uses relative wording for the recent past and near future", () => {
    expect(formatWhen(now - 10_000, now).text).toBe("just now");
    expect(formatWhen(now + 10_000, now).text).toBe("in a moment");
    expect(formatWhen(now - minute, now).text).toBe("1 minute ago");
    expect(formatWhen(now - 12 * minute, now).text).toBe("12 minutes ago");
    expect(formatWhen(now + 3 * minute, now).text).toBe("in 3 minutes");
    expect(formatWhen(now - 2 * 60 * minute, now).text).toBe("2 hours ago");
  });

  it("falls back to the local date and time after a day, in local time not UTC", () => {
    const when = now - 3 * 24 * 60 * minute;
    const shown = formatWhen(when, now);
    expect(shown.text).toBe(
      new Date(when).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }),
    );
    expect(shown.title).toBe(new Date(when).toLocaleString());
  });
});
