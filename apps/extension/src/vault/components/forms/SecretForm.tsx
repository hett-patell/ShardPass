import {
  MAX_SECRET_METADATA_ENTRIES,
  MAX_SECRET_METADATA_KEY_LENGTH,
  MAX_SECRET_METADATA_VALUE_LENGTH,
  MAX_SECRET_NAME_LENGTH,
  MAX_SECRET_NOTES_LENGTH,
  MAX_SECRET_VALUE_LENGTH,
  SecretItemSchema,
  type SecretItem,
} from "@shardpass/domain";
import { generateSshKey, inspectSshPrivateKey, type SshKeyInfo } from "@shardpass/crypto";
import { Button, Field, IconButton } from "@shardpass/ui";
import { Plus, X } from "lucide-react";
import { useEffect, useState } from "react";

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
  reprompt: boolean;
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

/** Metadata the form derives from an SSH private key itself; never typed by hand. */
const SSH_MANAGED_KEYS = ["publicKey", "fingerprint", "keyType"] as const;
const INSPECT_SETTLE_MS = 150;

function initialValue(item?: SecretItem): FormValue {
  return {
    name: item?.name ?? "",
    secretType: item?.secretType ?? "api_key",
    value: item?.value ?? "",
    metadata: Object.entries(item?.metadata ?? {})
      .filter(([key]) => item?.secretType !== "ssh_key" || !isManagedKey(key))
      .map(([key, value]) => ({ key, value })),
    notes: item?.notes ?? "",
    favorite: item?.favorite ?? false,
    reprompt: item?.reprompt ?? false,
    tags: formatTags(item?.tags ?? []),
  };
}

function isManagedKey(key: string): key is (typeof SSH_MANAGED_KEYS)[number] {
  return (SSH_MANAGED_KEYS as readonly string[]).includes(key);
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
  // What the private key says about itself; "unreadable" when it is not a key this vault can read.
  const [sshInfo, setSshInfo] = useState<SshKeyInfo | "unreadable" | null>(null);
  const [sshKind, setSshKind] = useState<"ed25519" | "rsa">("ed25519");
  const [sshComment, setSshComment] = useState("");
  const [generating, setGenerating] = useState(false);
  const isSshKey = value.secretType === "ssh_key";
  // The stored public key and fingerprint, kept when the pasted key cannot be read again
  // (a passphrase-protected key, say).
  const storedSsh = item?.secretType === "ssh_key" ? item.metadata : {};

  useEffect(() => {
    if (!isSshKey || value.value.trim() === "") {
      setSshInfo(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void inspectSshPrivateKey(value.value).then((info) => {
        if (!cancelled) setSshInfo(info ?? "unreadable");
      });
    }, INSPECT_SETTLE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isSshKey, value.value]);

  /** The public key, fingerprint and type the item will carry, from the key or what was stored. */
  const managedMetadata = (): Record<string, string> => {
    const managed: Record<string, string> = {};
    const readable = sshInfo !== null && sshInfo !== "unreadable" && sshInfo.keyType !== "";
    for (const key of SSH_MANAGED_KEYS) {
      const derived = readable ? sshInfo[key] : "";
      const stored = storedSsh[key] ?? "";
      const chosen = derived !== "" ? derived : value.value === item?.value ? stored : "";
      if (chosen !== "") managed[key] = chosen;
    }
    return managed;
  };

  const generate = async () => {
    setGenerating(true);
    try {
      const generated = await generateSshKey(sshKind, sshComment.trim());
      setValue((current) => ({
        ...current,
        value: generated.privateKey,
        name: current.name.trim() === "" ? `SSH key (${generated.keyType})` : current.name,
      }));
      setSshInfo({
        keyType: generated.keyType,
        publicKey: generated.publicKey,
        fingerprint: generated.fingerprint,
        comment: sshComment.trim(),
        encrypted: false,
      });
    } catch {
      setErrors((current) => ({ ...current, value: "The key could not be generated." }));
    } finally {
      setGenerating(false);
    }
  };

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
    const keys = value.metadata.map((row) => row.key.trim());
    if (value.metadata.some((row, index) => keys[index] === "" && row.value.trim() !== ""))
      nextErrors.metadata = "Every metadata row needs a key.";
    else if (
      new Set(keys.filter((key) => key !== "")).size !== keys.filter((key) => key !== "").length
    )
      nextErrors.metadata = "Metadata keys must be unique.";

    const fields = {
      name,
      secretType: value.secretType,
      value: value.value,
      metadata: isSshKey
        ? { ...metadataRecord(value.metadata), ...managedMetadata() }
        : metadataRecord(value.metadata),
      notes: value.notes,
      favorite: value.favorite,
      reprompt: value.reprompt ? true : undefined,
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

      {isSshKey ? (
        <div className={styles.field}>
          <span className={styles.label}>New key</span>
          <div className={styles.listRow}>
            <select
              className={styles.select}
              aria-label="Key algorithm"
              value={sshKind}
              onChange={(event) => setSshKind(event.target.value as "ed25519" | "rsa")}
            >
              <option value="ed25519">Ed25519 (recommended)</option>
              <option value="rsa">RSA 4096</option>
            </select>
            <input
              className={styles.textInput}
              placeholder="Comment (optional)"
              aria-label="Key comment"
              autoComplete="off"
              value={sshComment}
              onChange={(event) => setSshComment(event.target.value)}
            />
            <Button
              type="button"
              variant="secondary"
              loading={generating}
              onClick={() => void generate()}
            >
              Generate key
            </Button>
          </div>
          <p className={styles.help}>
            Made on this device with the browser's own cryptography; the private key never leaves
            the vault. Paste an existing OpenSSH, PEM or PuTTY key below instead, if you have one.
          </p>
        </div>
      ) : null}

      <div className={styles.field}>
        <label className={styles.label} htmlFor="secret-value">
          {isSshKey ? "Private key" : "Value"}
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

      {isSshKey && value.value.trim() !== "" ? (
        <div className={styles.field} aria-live="polite">
          {sshInfo === null ? (
            <p className={styles.help}>Reading the key…</p>
          ) : sshInfo === "unreadable" ? (
            <p className={styles.help}>
              This is not a private key ShardPass can read (OpenSSH, PKCS#8, PEM RSA or EC, PuTTY).
              It is stored as pasted.
            </p>
          ) : sshInfo.keyType === "" ? (
            <p className={styles.help}>
              This key is passphrase-protected, so its public key cannot be derived here. It is
              stored as pasted.
            </p>
          ) : (
            <>
              <label className={styles.label} htmlFor="secret-public-key">
                Public key
              </label>
              <textarea
                id="secret-public-key"
                className={styles.textarea}
                readOnly
                value={sshInfo.publicKey}
                spellCheck={false}
              />
              <p className={styles.help}>
                {sshInfo.keyType} · {sshInfo.fingerprint}
              </p>
            </>
          )}
        </div>
      ) : null}

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
              aria-label={`Metadata key ${index + 1}`}
              maxLength={MAX_SECRET_METADATA_KEY_LENGTH}
              value={row.key}
              onChange={(event) => updateRow(index, { key: event.target.value })}
            />
            <input
              className={styles.textInput}
              placeholder="Value"
              aria-label={`Metadata value ${index + 1}`}
              maxLength={MAX_SECRET_METADATA_VALUE_LENGTH}
              value={row.value}
              onChange={(event) => updateRow(index, { value: event.target.value })}
            />
            <IconButton aria-label="Remove metadata row" onClick={() => removeRow(index)}>
              <X size={16} />
            </IconButton>
          </div>
        ))}
        {value.metadata.length < MAX_SECRET_METADATA_ENTRIES ? (
          <button
            type="button"
            className={styles.linkButton}
            onClick={() =>
              setValue((current) => ({
                ...current,
                metadata: [...current.metadata, { key: "", value: "" }],
              }))
            }
          >
            <Plus size={12} aria-hidden="true" /> Add metadata row
          </button>
        ) : null}
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
      <label className={styles.checkboxField}>
        <input
          type="checkbox"
          checked={value.reprompt}
          onChange={(event) => setValue({ ...value, reprompt: event.target.checked })}
        />
        Ask for the master password before use
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
