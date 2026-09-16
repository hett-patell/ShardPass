// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CardBrandMark } from "../src/components/CardBrandMark";

afterEach(cleanup);

describe("CardBrandMark", () => {
  it("names the network for assistive technology and draws each one", () => {
    render(
      <>
        <CardBrandMark brand="visa" />
        <CardBrandMark brand="mastercard" />
        <CardBrandMark brand="amex" />
        <CardBrandMark brand="discover" />
        <CardBrandMark brand="jcb" />
        <CardBrandMark brand="unionpay" />
        <CardBrandMark brand="other" size={16} />
      </>,
    );
    for (const name of [
      "Visa",
      "Mastercard",
      "American Express",
      "Discover",
      "JCB",
      "UnionPay",
      "Card",
    ])
      expect(screen.getByRole("img", { name })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Visa" })).toHaveTextContent("VISA");
    expect(screen.getByRole("img", { name: "Card" })).toHaveAttribute("height", "16");
  });
});
