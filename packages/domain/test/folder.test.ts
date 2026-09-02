import { describe, expect, it } from "vitest";

import { FolderSchema, MAX_FOLDER_NAME_LENGTH } from "../src/folder";

const validFolder = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  name: "Work",
};

describe("FolderSchema", () => {
  it("accepts a valid folder", () => {
    expect(() => FolderSchema.parse(validFolder)).not.toThrow();
  });

  it("accepts an optional parentId", () => {
    expect(() =>
      FolderSchema.parse({ ...validFolder, parentId: "550e8400-e29b-41d4-a716-446655440001" }),
    ).not.toThrow();
  });

  it("rejects a malformed parentId", () => {
    expect(() => FolderSchema.parse({ ...validFolder, parentId: "not-a-uuid" })).toThrow();
  });

  it("rejects an empty name", () => {
    expect(() => FolderSchema.parse({ ...validFolder, name: "" })).toThrow();
  });

  it("rejects a name exceeding the max length", () => {
    expect(() =>
      FolderSchema.parse({ ...validFolder, name: "a".repeat(MAX_FOLDER_NAME_LENGTH + 1) }),
    ).toThrow();
  });

  it("accepts a name at the max length", () => {
    expect(() =>
      FolderSchema.parse({ ...validFolder, name: "a".repeat(MAX_FOLDER_NAME_LENGTH) }),
    ).not.toThrow();
  });

  it("rejects an untrimmed name", () => {
    expect(() => FolderSchema.parse({ ...validFolder, name: " Work " })).toThrow();
  });

  it("rejects a malformed id", () => {
    expect(() => FolderSchema.parse({ ...validFolder, id: "not-a-uuid" })).toThrow();
  });

  it("rejects unknown properties", () => {
    expect(() => FolderSchema.parse({ ...validFolder, unexpected: "nope" })).toThrow();
  });
});
