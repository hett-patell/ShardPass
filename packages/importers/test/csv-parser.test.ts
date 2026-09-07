import { describe, expect, it } from "vitest";

import { parseCsv } from "../src/common/csv-parser";

describe("parseCsv", () => {
  it("keeps newlines inside quoted fields, so later rows stay aligned", () => {
    const csv = 'name,url,username,password,note\r\n"Bank","https://bank.example","me","p1","line one\nline two, with comma\r\nline three"\r\nShop,https://shop.example,me2,p2,plain\r\n';
    const { headers, rows } = parseCsv(csv);
    expect(headers).toEqual(["name", "url", "username", "password", "note"]);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.note).toBe("line one\nline two, with comma\r\nline three");
    expect(rows[1]).toEqual({ name: "Shop", url: "https://shop.example", username: "me2", password: "p2", note: "plain" });
  });

  it("handles a BOM, doubled quotes, empty fields and a missing final newline", () => {
    const { rows } = parseCsv('﻿a,b,c\n"say ""hi""",,last');
    expect(rows).toEqual([{ a: 'say "hi"', b: "", c: "last" }]);
  });
});
