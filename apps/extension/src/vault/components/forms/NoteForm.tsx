import { MAX_NOTE_CONTENT_LENGTH, MAX_NOTE_NAME_LENGTH, NoteItemSchema, type NoteItem } from "@shardpass/domain";
import { Button, Field } from "@shardpass/ui";
import { useState } from "react";

import type { ExtensionPlatform } from "../../../platform/extension-platform";
import { formatTags, newItemMetadata, parseTags, schemaErrors } from "../../item-support";
import styles from "./Form.module.css";
import { createItem, updateItem } from "./submit-item";

export interface NoteFormProps {
  /** Omit to create a new note; pass the existing item to edit it. */
  item?: NoteItem;
  platform: Pick<ExtensionPlatform, "sendMessage">;
  onSaved: (item: NoteItem) => void;
  onCancel: () => void;
}

interface FormValue {
  name: string;
  content: string;
  favorite: boolean;
  tags: string;
}

type FieldKey = "name" | "content" | "tags";
type Errors = Partial<Record<FieldKey | "form", string>>;

/** Fields the form can show a schema error beside. */
const FIELDS: readonly FieldKey[] = ["name", "content", "tags"];

function initialValue(item?: NoteItem): FormValue {
  return {
    name: item?.name ?? "",
    content: item?.content ?? "",
    favorite: item?.favorite ?? false,
    tags: formatTags(item?.tags ?? []),
  };
}

export function NoteForm({ item, platform, onSaved, onCancel }: NoteFormProps) {
  const [value, setValue] = useState<FormValue>(() => initialValue(item));
  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    const name = value.name.trim();
    const tags = parseTags(value.tags);
    const nextErrors: Errors = {};
    if (name.length === 0) nextErrors.name = "Enter a name.";
    if (value.content.length > MAX_NOTE_CONTENT_LENGTH) nextErrors.content = "Content is too long.";

    const candidate = item
      ? { ...item, name, content: value.content, favorite: value.favorite, tags }
      : {
          ...newItemMetadata(),
          kind: "note" as const,
          name,
          content: value.content,
          favorite: value.favorite,
          tags,
        };
    const parsed = NoteItemSchema.safeParse(candidate);
    if (Object.keys(nextErrors).length === 0 && !parsed.success)
      Object.assign(nextErrors, schemaErrors(parsed.error.issues, FIELDS));
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSubmitting(true);
    const result = item
      ? await updateItem(platform, item.id, item.revision, {
          name,
          content: value.content,
          favorite: value.favorite,
          tags,
        })
      : await createItem(platform, candidate);
    setSubmitting(false);
    if (result.status === "saved" && result.item.kind === "note") {
      onSaved(result.item);
      return;
    }
    setErrors({
      form:
        result.status === "conflict"
          ? "This item changed elsewhere. Reload and try again."
          : "Could not save. Try again.",
    });
  };

  return (
    <form
      className={styles.form}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <header className={styles.header}>
        <h2 className={styles.title}>{item ? "Edit note" : "New note"}</h2>
      </header>

      {errors.form ? (
        <p className={styles.formError} role="alert">
          {errors.form}
        </p>
      ) : null}

      <Field
        label="Name"
        error={errors.name}
        inputProps={{
          autoFocus: true,
          value: value.name,
          maxLength: MAX_NOTE_NAME_LENGTH,
          autoComplete: "off",
          onChange: (event) => setValue({ ...value, name: event.target.value }),
        }}
      />

      <div className={styles.field}>
        <label className={styles.label} htmlFor="note-content">
          Content
        </label>
        <textarea
          id="note-content"
          className={styles.textarea}
          value={value.content}
          maxLength={MAX_NOTE_CONTENT_LENGTH}
          spellCheck={false}
          onChange={(event) => setValue({ ...value, content: event.target.value })}
        />
        {errors.content ? (
          <p className={styles.fieldError} role="alert">
            {errors.content}
          </p>
        ) : null}
      </div>

      <Field
        label="Tags"
        error={errors.tags}
        help="Comma-separated."
        inputProps={{
          value: value.tags,
          autoComplete: "off",
          onChange: (event) => setValue({ ...value, tags: event.target.value }),
        }}
      />

      <label className={styles.checkboxField}>
        <input
          type="checkbox"
          checked={value.favorite}
          onChange={(event) => setValue({ ...value, favorite: event.target.checked })}
        />
        Favorite
      </label>

      <div className={styles.actions}>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
        <Button type="submit" loading={submitting}>
          Save
        </Button>
      </div>
    </form>
  );
}
