// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import type { LoginItem } from "@shardpass/domain";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { StrengthEstimator } from "../../src/vault-access/strength-estimator";
import { HealthView } from "../../src/vault/health/HealthView";

afterEach(cleanup);

const login = (
  id: string,
  name: string,
  password: string,
  extra: Partial<LoginItem> = {},
): LoginItem => ({
  id: `10000000-0000-4000-8000-0000000000${id}`,
  schemaVersion: 2,
  revision: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  favorite: false,
  tags: [],
  kind: "login",
  name,
  username: "me",
  password,
  urls: ["https://site.test"],
  notes: "",
  ...extra,
});

const estimator: StrengthEstimator = {
  estimate: (password) =>
    Promise.resolve({
      bits: 0,
      level: password === "weak" ? 0 : 3,
      label: password === "weak" ? "Too weak" : "Strong",
      source: "full",
    }),
  dispose: () => undefined,
};

describe("HealthView", () => {
  it("lists weak, reused and unencrypted-site logins, opens one on click, and checks breaches on request", async () => {
    const items = [
      login("01", "Weak one", "weak"),
      login("02", "Twin A", "twin"),
      login("03", "Twin B", "twin"),
      login("04", "Old site", "strong-and-long", { urls: ["http://old.test"] }),
    ];
    const sendMessage = vi.fn((request: { kind: string; itemId?: string }) =>
      Promise.resolve(
        request.kind === "security.checkItem"
          ? {
              version: 1,
              kind: "security.breachResult",
              itemId: request.itemId,
              count: request.itemId?.endsWith("01") ? 42 : 0,
              checkedAt: 1,
            }
          : undefined,
      ),
    );
    const onOpenItem = vi.fn();
    render(
      <HealthView
        platform={{ sendMessage }}
        items={items}
        redactedIds={new Set()}
        active
        onOpenItem={onOpenItem}
        estimator={estimator}
      />,
    );
    const weak = screen.getByRole("region", { name: /Weak passwords/u });
    expect(await within(weak).findByText("Weak one")).toBeVisible();
    expect(within(weak).queryByText("Twin A")).toBeNull();
    const reused = screen.getByRole("region", { name: /Reused passwords/u });
    expect(within(reused).getByText("Twin A")).toBeVisible();
    expect(within(reused).getByText("Twin B")).toBeVisible();
    const unsecured = screen.getByRole("region", { name: /Unencrypted sites/u });
    expect(within(unsecured).getByText("Old site")).toBeVisible();

    fireEvent.click(within(reused).getByText("Twin A"));
    expect(onOpenItem).toHaveBeenCalledWith("10000000-0000-4000-8000-000000000002");

    fireEvent.click(screen.getByRole("button", { name: "Check now" }));
    const breached = screen.getByRole("region", { name: /Breached passwords/u });
    expect(await within(breached).findByText("Weak one")).toBeVisible();
    expect(within(breached).getByText(/seen 42 times/u)).toBeVisible();
    // One listing at mount, then one check per login.
    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(5));
    expect(await screen.findByText(/4 of 4 checked/u)).toBeVisible();
  });
});

describe("HealthView remembered verdicts", () => {
  it("shows what the background remembers and checks only the rest", async () => {
    const items = [
      login("01", "Checked before", "strong-and-long-one"),
      login("02", "Changed since", "strong-and-long-two"),
      login("03", "Never checked", "strong-and-long-three"),
    ];
    const checked: string[] = [];
    const sendMessage = vi.fn((request: { kind: string; itemId?: string; force?: boolean }) => {
      if (request.kind === "security.listResults")
        return Promise.resolve({
          version: 1,
          kind: "security.results",
          results: [
            {
              itemId: "10000000-0000-4000-8000-000000000001",
              count: 7,
              checkedAt: 1,
              stale: false,
            },
            { itemId: "10000000-0000-4000-8000-000000000002", count: 0, checkedAt: 1, stale: true },
          ],
        });
      checked.push(`${request.itemId ?? ""}${request.force ? "!" : ""}`);
      return Promise.resolve({
        version: 1,
        kind: "security.breachResult",
        itemId: request.itemId,
        count: 0,
        checkedAt: 2,
      });
    });
    render(
      <HealthView
        platform={{ sendMessage }}
        items={items}
        redactedIds={new Set()}
        active
        onOpenItem={() => undefined}
        estimator={estimator}
      />,
    );
    const breached = screen.getByRole("region", { name: /Breached passwords/u });
    expect(await within(breached).findByText(/1 of 3 checked, 2 not yet/u)).toBeVisible();
    expect(within(breached).getByText("Checked before")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Check 2 unchecked" }));
    await waitFor(() => expect(checked).toHaveLength(2));
    expect(checked).toEqual([
      "10000000-0000-4000-8000-000000000002",
      "10000000-0000-4000-8000-000000000003",
    ]);
    expect(await within(breached).findByText(/3 of 3 checked/u)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Check all again" }));
    await waitFor(() => expect(checked).toHaveLength(5));
    expect(checked.slice(2).every((entry) => entry.endsWith("!"))).toBe(true);
  });
});
