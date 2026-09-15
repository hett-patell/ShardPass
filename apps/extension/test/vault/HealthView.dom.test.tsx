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
    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(4));
  });
});
