import "@testing-library/jest-dom/vitest";

import axe from "axe-core";
import { CircleAlert, Settings } from "lucide-react";
import { createRef } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AppHeader, Button, Field, IconButton, ShardPassMark, StatusBadge } from "../src/index";

afterEach(cleanup);

async function expectNoAxeViolations(container: HTMLElement): Promise<void> {
  const results = await axe.run(container, {
    rules: { "color-contrast": { enabled: false } },
  });
  expect(results.violations).toEqual([]);
}

describe("Button", () => {
  it("exposes disabled and loading states without submitting", () => {
    const { rerender } = render(<Button disabled>Save</Button>);
    const disabledButton = screen.getByRole("button", { name: "Save" });

    expect(disabledButton).toBeDisabled();
    expect(disabledButton).toHaveAttribute("data-state", "disabled");

    rerender(<Button loading>Save</Button>);
    const loadingButton = screen.getByRole("button", { name: /Save/ });

    expect(loadingButton).toBeDisabled();
    expect(loadingButton).toHaveAttribute("aria-busy", "true");
    expect(loadingButton).toHaveAttribute("data-state", "loading");
    expect(screen.getByText("Loading").className).toMatch(/visuallyHidden/);
  });

  it("uses the native button type and forwards its ref", () => {
    const ref = createRef<HTMLButtonElement>();
    render(<Button ref={ref}>Open vault</Button>);

    expect(ref.current).toBe(screen.getByRole("button", { name: "Open vault" }));
    expect(ref.current).toHaveAttribute("type", "button");
  });
});

describe("IconButton", () => {
  it("requires a non-empty accessible label at runtime", () => {
    expect(() =>
      render(
        <IconButton aria-label="">
          <Settings aria-hidden="true" />
        </IconButton>,
      ),
    ).toThrow(/accessible label/i);
  });

  it("renders an icon-only control with an accessible name", async () => {
    const { container } = render(
      <IconButton aria-label="Settings">
        <Settings aria-hidden="true" />
      </IconButton>,
    );

    expect(screen.getByRole("button", { name: "Settings" })).toBeVisible();
    await expectNoAxeViolations(container);
  });
});

describe("Field", () => {
  it("associates its label, help, and error with the control", async () => {
    const { container } = render(
      <Field
        label="Vault name"
        help="Use a name you will recognize."
        error="A vault name is required."
        inputProps={{ name: "vaultName" }}
      />,
    );
    const input = screen.getByRole("textbox", { name: "Vault name" });
    const help = screen.getByText("Use a name you will recognize.").closest("p");
    const error = screen.getByText("A vault name is required.").closest("p");

    expect(help).not.toBeNull();
    expect(error).not.toBeNull();

    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", `${help?.id} ${error?.id}`);
    expect(error).toHaveAttribute("role", "alert");
    await expectNoAxeViolations(container);
  });

  it("supports explicit ids without collisions", () => {
    render(<Field id="account-email" label="Email" inputProps={{ type: "email" }} />);

    expect(screen.getByLabelText("Email")).toHaveAttribute("id", "account-email");
  });
});

describe("StatusBadge", () => {
  it("communicates semantic status with text and a hidden icon", async () => {
    const { container } = render(<StatusBadge status="error">Connection failed</StatusBadge>);
    const status = screen.getByRole("status");

    expect(status).toHaveTextContent("Connection failed");
    expect(status).toHaveAttribute("data-status", "error");
    expect(status.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    await expectNoAxeViolations(container);
  });

  it("accepts a decorative custom icon while retaining visible text", () => {
    render(
      <StatusBadge status="warning" icon={<CircleAlert data-testid="custom-icon" />}>
        Review required
      </StatusBadge>,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Review required");
    expect(screen.getByTestId("custom-icon")).toHaveAttribute("aria-hidden", "true");
  });
});

describe("brand and header", () => {
  it("renders the original flat mark as decorative by default", () => {
    const { container } = render(<ShardPassMark />);
    const mark = container.querySelector("svg");

    expect(mark).toHaveAttribute("aria-hidden", "true");
    expect(mark?.querySelectorAll("path")).toHaveLength(1);
    expect(mark?.querySelector("linearGradient, radialGradient, filter")).toBeNull();
  });

  it("gives a titled standalone mark an image role", () => {
    render(<ShardPassMark title="ShardPass" />);

    expect(screen.getByRole("img", { name: "ShardPass" })).toBeVisible();
  });

  it("provides a labeled header landmark and action slot", async () => {
    const { container } = render(
      <AppHeader
        eyebrow="FOUNDATION"
        title="ShardPass"
        actions={
          <IconButton aria-label="Settings">
            <Settings aria-hidden="true" />
          </IconButton>
        }
      />,
    );

    expect(screen.getByRole("banner")).toHaveAccessibleName("ShardPass");
    const headerMark = container.querySelector("header svg");
    expect(headerMark?.getAttribute("class")).toMatch(/headerMark/);
    expect(screen.getByText("FOUNDATION")).toBeVisible();
    expect(screen.getByRole("button", { name: "Settings" })).toBeVisible();
    await expectNoAxeViolations(container);
  });
});
