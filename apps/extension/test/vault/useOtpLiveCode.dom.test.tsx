import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { OtpRequest, OtpResponse } from "@shardpass/messaging";

import { useOtpLiveCode } from "../../src/vault/components/detail/useOtpLiveCode";

const ITEM = "018f47a6-7d11-7c2f-8bd9-a1d37f147a20";

function platform(codes: readonly string[], period = 30_000) {
  let served = 0;
  const sendOtpMessage = vi.fn((request: OtpRequest): Promise<OtpResponse> => {
    if (request.kind !== "otp.getCode") return Promise.reject(new Error("unused"));
    const code = codes[Math.min(served, codes.length - 1)] ?? "000000";
    served += 1;
    return Promise.resolve({
      version: 1,
      kind: "otp.codeResult",
      itemId: ITEM,
      revision: 1,
      code,
      period: period / 1_000,
      expiresAt: Date.now() + period,
    } as OtpResponse);
  });
  return { sendOtpMessage, requests: () => served };
}

function Probe({
  platform: candidate,
}: {
  platform: { sendOtpMessage: ReturnType<typeof vi.fn> };
}) {
  const { code, remaining } = useOtpLiveCode(candidate as never, ITEM, true);
  return (
    <p>
      {code?.code ?? "none"} / {remaining}
    </p>
  );
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useOtpLiveCode", () => {
  it("keeps counting down and asks for the next code when this one expires", async () => {
    vi.useFakeTimers();
    const candidate = platform(["111111", "222222"]);
    render(<Probe platform={candidate} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText(/111111 \/ 30/u)).toBeDefined();

    // Each tick has to schedule the next one: before this was fixed the countdown moved once
    // and then froze, and the code was never asked for again.
    const tick = async (seconds: number) => {
      for (let second = 0; second < seconds; second += 1)
        await act(async () => {
          await vi.advanceTimersByTimeAsync(1_000);
        });
    };
    await tick(5);
    expect(screen.getByText(/111111 \/ 2[45]/u)).toBeDefined();

    await tick(27);
    expect(screen.getByText(/222222/u)).toBeDefined();
    expect(candidate.requests()).toBe(2);
  });
});
