import { describe, expect, it } from "vitest";

import { compareItems, matchesQuery, parseQuery, searchableText } from "../src/search";

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

describe("parseQuery and matchesQuery", () => {
  const login = {
    ...base,
    kind: "login" as const,
    name: "GitHub",
    username: "octocat",
    password: "hunter2",
    urls: ["https://github.com/login"],
    notes: "",
    tags: ["Work", "code"],
  };

  it("reads #tags and free words apart, and ignores a bare hash", () => {
    expect(parseQuery("#wo GitHub  #")).toEqual({ terms: ["github"], tags: ["wo"] });
  });

  it("requires every tag by prefix and every word somewhere, never the password", () => {
    expect(matchesQuery(login, parseQuery("#work"))).toBe(true);
    expect(matchesQuery(login, parseQuery("#wo git"))).toBe(true);
    expect(matchesQuery(login, parseQuery("#home"))).toBe(false);
    expect(matchesQuery(login, parseQuery("octo github"))).toBe(true);
    expect(matchesQuery(login, parseQuery("hunter2"))).toBe(false);
  });
});

describe("compareItems", () => {
  const first = { ...base, kind: "note" as const, id: "11111111-1111-4111-8111-111111111112", name: "Alpha", content: "", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-03-01T00:00:00.000Z" };
  const second = { ...base, kind: "note" as const, id: "11111111-1111-4111-8111-111111111113", name: "beta", content: "", createdAt: "2026-02-01T00:00:00.000Z", updatedAt: "2026-02-01T00:00:00.000Z" };
  const used = { ...base, kind: "login" as const, id: "11111111-1111-4111-8111-111111111114", name: "Gamma", username: "", password: "", urls: [], notes: "", createdAt: "2025-01-01T00:00:00.000Z", updatedAt: "2025-01-01T00:00:00.000Z", lastUsedAt: "2026-04-01T00:00:00.000Z" };

  it("sorts by name case-insensitively, by when added, by when updated, and by last use", () => {
    const names = (sort: Parameters<typeof compareItems>[0]) => [first, second, used].sort(compareItems(sort)).map((item) => item.name);
    expect(names("name")).toEqual(["Alpha", "beta", "Gamma"]);
    expect(names("added")).toEqual(["beta", "Alpha", "Gamma"]);
    expect(names("updated")).toEqual(["Alpha", "beta", "Gamma"]);
    expect(names("recent")).toEqual(["Gamma", "Alpha", "beta"]);
  });
});
