import {
  MAX_SECRET_NAME_LENGTH,
  MAX_SECRET_NOTES_LENGTH,
  MAX_SECRET_VALUE_LENGTH,
  SecretItemSchema,
  type SecretItem,
} from "@shardpass/domain";
import { Button, Field, IconButton } from "@shardpass/ui";
import { Plus, X } from "lucide-react";
import { useState } from "react";

import type { ExtensionPlatform } from "../../../platform/extension-platform";
import { formatTags, newItemMetadata, parseTags, schemaErrors } from "../../item-support";
import styles from "./Form.module.css";
import { createItem, updateItem } from "./submit-item";

export interface SecretFormProps {
  item?: SecretItem;
  platform: Pick<ExtensionPlatform, "sendMessage">;
  onSaved: (item: SecretItem) => void;
  onCancel: () => void;
}

interface MetadataRow {
  key: string;
  value: string;
}

interface FormValue {
  name: string;
  secretType: SecretItem["secretType"];
  value: string;
  metadata: MetadataRow[];
  notes: string;
  favorite: boolean;
  tags: string;
}

type FieldKey = "name" | "value" | "metadata" | "notes" | "tags";
type Errors = Partial<Record<FieldKey | "form", string>>;

/** Fields the form can show a schema error beside. */
const FIELDS: readonly FieldKey[] = ["name", "value", "metadata", "notes", "tags"];

const secretTypeOptions: readonly { value: SecretItem["secretType"]; label: string }[] = [
  { value: "api_key", label: "API key" },
  { value: "ssh_key", label: "SSH key" },
  { value: "token", label: "Token" },
  { value: "env", label: "Environment variable" },
  { value: "other", label: "Other" },
];

function initialValue(item?: SecretItem): FormValue {
  return {
    name: item?.name ?? "",
    secretType: item?.secretType ?? "api_key",
    value: item?.value ?? "",
    metadata: Object.entries(item?.metadata ?? {}).map(([key, value]) => ({ key, value })),
    notes: item?.notes ?? "",
    favorite: item?.favorite ?? false,
    tags: formatTags(item?.tags ?? []),
  };
}

function metadataRecord(rows: readonly MetadataRow[]): Record<string, string> {
  const record: Record<string, string> = {};
  for (const row of rows) {
    const key = row.key.trim();
    if (key.length === 0) continue;
    record[key] = row.value;
  }
  return record;
}

export function SecretForm({ item, platform, onSaved, onCancel }: SecretFormProps) {
  const [value, setValue] = useState<FormValue>(() => initialValue(item));
  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);

  const updateRow = (index: number, patch: Partial<MetadataRow>) => {
    setValue((current) => ({
      ...current,
      metadata: current.metadata.map((row, rowIndex) =>
        rowIndex === index ? { ...row, ...patch } : row,
      ),
    }));
  };
  const removeRow = (index: number) => {
    setValue((current) => ({
      ...current,
      metadata: current.metadata.filter((_, rowIndex) => rowIndex !== index),
    }));
  };

  const submit = async () => {
    const name = value.name.trim();
    const tags = parseTags(value.tags);
    const nextErrors: Errors = {};
    if (name.length === 0) nextErrors.name = "Enter a name.";

    const fields = {
      name,
      secretType: value.secretType,
      value: value.value,
      metadata: metadataRecord(value.metadata),
      notes: value.notes,
      favorite: value.favorite,
      tags,
    };
    const candidate = item
      ? { ...item, ...fields }
      : { ...newItemMetadata(), kind: "secret" as const, ...fields };
    const parsed = SecretItemSchema.safeParse(candidate);
    if (Object.keys(nextErrors).length === 0 && !parsed.success)
      Object.assign(nextErrors, schemaErrors(parsed.error.issues, FIELDS));
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSubmitting(true);
    const result = item
      ? await updateItem(platform, item.id, item.revision, fields)
      : await createItem(platform, candidate);
    setSubmitting(false);
    if (result.status === "saved" && result.item.kind === "secret") {
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
        <h2 className={styles.title}>{item ? "Edit secret" : "New secret"}</h2>
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
          maxLength: MAX_SECRET_NAME_LENGTH,
          autoComplete: "off",
          onChange: (event) => setValue({ ...value, name: event.target.value }),
        }}
      />

      <div className={styles.field}>
        <label className={styles.label} htmlFor="secret-type">
          Type
        </label>
        <select
          id="secret-type"
          className={styles.select}
          value={value.secretType}
          onChange={(event) =>
            setValue({ ...value, secretType: event.target.value as SecretItem["secretType"] })
          }
        >
          {secretTypeOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="secret-value">
          Value
        </label>
        <textarea
          id="secret-value"
          className={styles.textarea}
          value={value.value}
          maxLength={MAX_SECRET_VALUE_LENGTH}
          spellCheck={false}
          autoComplete="off"
          aria-invalid={errors.value ? true : undefined}
          onChange={(event) => setValue({ ...value, value: event.target.value })}
        />
        {errors.value ? (
          <p className={styles.fieldError} role="alert">
            {errors.value}
          </p>
        ) : null}
      </div>

      <div className={styles.field}>
        <span className={styles.label}>Metadata</span>
        {errors.metadata ? (
          <p className={styles.fieldError} role="alert">
            {errors.metadata}
          </p>
        ) : null}
        {value.metadata.map((row, index) => (
          <div key={index} className={styles.listRow}>
            <input
              className={styles.textInput}
              placeholder="Key"
              value={row.key}
              onChange={(event) => updateRow(index, { key: event.target.value })}
            />
            <input
              className={styles.textInput}
              placeholder="Value"
              value={row.value}
              onChange={(event) => updateRow(index, { value: event.target.value })}
            />
            <IconButton aria-label="Remove metadata row" onClick={() => removeRow(index)}>
              <X size={16} />
            </IconButton>
          </div>
        ))}
        <button
          type="button"
          className={styles.linkButton}
          onClick={() =>
            setValue((current) => ({ ...current, metadata: [...current.metadata, { key: "", value: "" }] }))
          }
        >
          <Plus size={12} aria-hidden="true" /> Add metadata row
        </button>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="secret-notes">
          Notes
        </label>
        <textarea
          id="secret-notes"
          className={styles.textarea}
          value={value.notes}
          maxLength={MAX_SECRET_NOTES_LENGTH}
          spellCheck={false}
          aria-invalid={errors.notes ? true : undefined}
          onChange={(event) => setValue({ ...value, notes: event.target.value })}
        />
        {errors.notes ? (
          <p className={styles.fieldError} role="alert">
            {errors.notes}
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
