import "@testing-library/jest-dom/vitest";

import type { OtpRequest, OtpResponse } from "@shardpass/messaging";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LiveCode } from "../../src/popup/components/LiveCode";

const ITEM_ID = "10000000-0000-4000-8000-000000000020";

function codeResult(code: string, expiresAt: number): OtpResponse {
  return {
    version: 1,
    kind: "otp.codeResult",
    itemId: ITEM_ID,
    revision: 1,
    code,
    otpType: "totp",
    period: 30,
    remaining: 30,
    expiresAt,
  };
}

afterEach(cleanup);

describe("LiveCode", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("counts down every second and fetches the next code when the current one expires", async () => {
    const start = Date.now();
    const codes = ["111111", "222222"];
    const sendOtpMessage = vi.fn<(request: OtpRequest) => Promise<OtpResponse>>(() => {
      const code = codes.shift() ?? "333333";
      return Promise.resolve(codeResult(code, Date.now() + 3_000));
    });
    render(<LiveCode platform={{ sendOtpMessage }} itemId={ITEM_ID} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText("111 111")).toBeInTheDocument();
    expect(screen.getByTestId("otp-countdown")).toHaveTextContent("3");

    const tick = () =>
      act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
      });
    await tick();
    expect(screen.getByTestId("otp-countdown")).toHaveTextContent("2");
    await tick();
    expect(screen.getByTestId("otp-countdown")).toHaveTextContent("1");
    expect(sendOtpMessage).toHaveBeenCalledTimes(1);

    await tick();
    expect(sendOtpMessage).toHaveBeenCalledTimes(2);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText("222 222")).toBeInTheDocument();
    expect(Date.now() - start).toBeGreaterThanOrEqual(3_000);
  });
});
