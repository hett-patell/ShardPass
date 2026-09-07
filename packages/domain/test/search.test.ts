import { describe, expect, it } from "vitest";

import { searchableText } from "../src/search";

const base = {
  id: "11111111-1111-4111-8111-111111111111",
  schemaVersion: 2 as const,
  revision: 1,
  createdAt: "2026-08-10T12:00:00.000Z",
  updatedAt: "2026-08-10T12:00:00.000Z",
  favorite: false,
  tags: ["work"],
};

describe("searchableText", () => {
  it("names a login by its title, username, URL hosts and tags, never its password", () => {
    const text = searchableText({
      ...base,
      kind: "login",
      name: "GitHub",
      username: "octocat",
      password: "hunter2",
      urls: ["https://github.com/login", "gitlab.com"],
      notes: "",
    });
    expect(text).toEqual(["GitHub", "octocat", "github.com", "gitlab.com", "work"]);
    expect(text.join(" ")).not.toContain("hunter2");
  });

  it("skips fields a kind does not have and empty strings", () => {
    const text = searchableText({
      ...base,
      kind: "identity",
      name: "Me",
      firstName: "",
      lastName: "Patel",
      email: "me@example.com",
    } as never);
    expect(text).toEqual(["Me", "Patel", "me@example.com", "work"]);
  });
});
