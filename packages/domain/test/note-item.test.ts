import { describe, expect, it } from "vitest";

import { MAX_NOTE_CONTENT_LENGTH, NoteItemSchema } from "../src/note-item";

const validNote = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  kind: "note" as const,
  schemaVersion: 2,
  revision: 1,
  createdAt: "2026-09-02T10:00:00Z",
  updatedAt: "2026-09-02T10:00:00Z",
  favorite: false,
  tags: [],
  name: "Wifi password",
  content: "the secret note contents",
};

describe("NoteItemSchema", () => {
  it("accepts a valid note item", () => {
    expect(() => NoteItemSchema.parse(validNote)).not.toThrow();
  });

  it("rejects an empty name", () => {
    expect(() => NoteItemSchema.parse({ ...validNote, name: "" })).toThrow();
  });

  it("rejects a name exceeding max length", () => {
    expect(() => NoteItemSchema.parse({ ...validNote, name: "a".repeat(257) })).toThrow();
  });

  it("rejects an untrimmed name", () => {
    expect(() => NoteItemSchema.parse({ ...validNote, name: " Wifi " })).toThrow();
  });

  it("accepts empty content", () => {
    expect(() => NoteItemSchema.parse({ ...validNote, content: "" })).not.toThrow();
  });

  it("accepts content at the max length", () => {
    expect(() =>
      NoteItemSchema.parse({ ...validNote, content: "a".repeat(MAX_NOTE_CONTENT_LENGTH) }),
    ).not.toThrow();
  });

  it("rejects content exceeding max length", () => {
    expect(() =>
      NoteItemSchema.parse({ ...validNote, content: "a".repeat(MAX_NOTE_CONTENT_LENGTH + 1) }),
    ).toThrow();
  });

  it("rejects wrong kind", () => {
    expect(() => NoteItemSchema.parse({ ...validNote, kind: "login" })).toThrow();
  });

  it("rejects a stale schemaVersion", () => {
    expect(() => NoteItemSchema.parse({ ...validNote, schemaVersion: 1 })).toThrow();
  });

  it("rejects unknown properties", () => {
    expect(() => NoteItemSchema.parse({ ...validNote, unexpected: "nope" })).toThrow();
  });
});
