import {
  LoginItemSchema,
  MAX_LOGIN_NAME_LENGTH,
  MAX_LOGIN_NOTES_LENGTH,
  MAX_LOGIN_URLS,
  MAX_LOGIN_URL_LENGTH,
  MAX_LOGIN_USERNAME_LENGTH,
  type LoginItem,
  type OtpItem,
} from "@shardpass/domain";
import { Button, Field, IconButton } from "@shardpass/ui";
import { KeyRound, Plus, X } from "lucide-react";
import { useState } from "react";

import type { ExtensionPlatform } from "../../../platform/extension-platform";
import { formatTags, newItemMetadata, parseTags } from "../../item-support";
import { PasswordGeneratorDialog } from "../PasswordGeneratorDialog";
import styles from "./Form.module.css";
import { SensitiveField } from "./SensitiveField";
import { createItem, updateItem } from "./submit-item";

export interface LoginFormProps {
  item?: LoginItem;
  platform: ExtensionPlatform;
  otpItems: readonly OtpItem[];
  onSaved: (item: LoginItem) => void;
  onCancel: () => void;
}

interface FormValue {
  name: string;
  username: string;
  password: string;
  urls: string[];
  linkedOtpId: string;
  notes: string;
  favorite: boolean;
  tags: string;
}

type Errors = Partial<Record<"name" | "form", string>>;

function initialValue(item?: LoginItem): FormValue {
  return {
    name: item?.name ?? "",
    username: item?.username ?? "",
    password: item?.password ?? "",
    urls: item && item.urls.length > 0 ? [...item.urls] : [""],
    linkedOtpId: item?.linkedOtpId ?? "",
    notes: item?.notes ?? "",
    favorite: item?.favorite ?? false,
    tags: formatTags(item?.tags ?? []),
  };
}

export function LoginForm({ item, platform, otpItems, onSaved, onCancel }: LoginFormProps) {
  const [value, setValue] = useState<FormValue>(() => initialValue(item));
  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);
  const [generatorOpen, setGeneratorOpen] = useState(false);

  const updateUrl = (index: number, next: string) => {
    setValue((current) => ({
      ...current,
      urls: current.urls.map((url, urlIndex) => (urlIndex === index ? next : url)),
    }));
  };
  const removeUrl = (index: number) => {
    setValue((current) => ({ ...current, urls: current.urls.filter((_, i) => i !== index) }));
  };

  const submit = async () => {
    const name = value.name.trim();
    const tags = parseTags(value.tags);
    const urls = value.urls.map((url) => url.trim()).filter((url) => url.length > 0);
    const nextErrors: Errors = {};
    if (name.length === 0) nextErrors.name = "Enter a name.";

    // linkedOtpId is always included explicitly (string id or undefined) rather than
    // conditionally omitted: item.update merges `fields` into the stored item with a
    // plain object spread, where an omitted key keeps the old value but an explicit
    // `undefined` clears it — so clearing the selection must send `undefined`, not omit
    // the key, or a previously linked OTP could never be unlinked.
    const linkedOtpId = value.linkedOtpId.length > 0 ? value.linkedOtpId : undefined;
    const fields = {
      name,
      username: value.username,
      password: value.password,
      urls,
      linkedOtpId,
      notes: value.notes,
      favorite: value.favorite,
      tags,
    };
    const candidate = item
      ? { ...item, ...fields }
      : { ...newItemMetadata(), kind: "login" as const, ...fields };
    if (Object.keys(nextErrors).length === 0 && !LoginItemSchema.safeParse(candidate).success) {
      nextErrors.form = "Review the highlighted fields.";
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSubmitting(true);
    const result = item
      ? await updateItem(platform, item.id, item.revision, fields)
      : await createItem(platform, candidate);
    setSubmitting(false);
    if (result.status === "saved" && result.item.kind === "login") {
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
        <p className={styles.eyebrow}>LOGIN</p>
        <h2 className={styles.title}>{item ? "Edit login" : "New login"}</h2>
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
          value: value.name,
          maxLength: MAX_LOGIN_NAME_LENGTH,
          autoComplete: "off",
          onChange: (event) => setValue({ ...value, name: event.target.value }),
        }}
      />

      <Field
        label="Username"
        inputProps={{
          value: value.username,
          maxLength: MAX_LOGIN_USERNAME_LENGTH,
          autoComplete: "username",
          onChange: (event) => setValue({ ...value, username: event.target.value }),
        }}
      />

      <SensitiveField
        label="Password"
        value={value.password}
        onChange={(next) => setValue({ ...value, password: next })}
        extraAction={
          <IconButton aria-label="Generate password" onClick={() => setGeneratorOpen(true)}>
            <KeyRound size={16} />
          </IconButton>
        }
      />

      <div className={styles.field}>
        <span className={styles.label}>URLs</span>
        {value.urls.map((url, index) => (
          <div key={index} className={styles.listRow}>
            <input
              className={styles.textInput}
              type="url"
              placeholder="https://example.com"
              maxLength={MAX_LOGIN_URL_LENGTH}
              value={url}
              onChange={(event) => updateUrl(index, event.target.value)}
            />
            {value.urls.length > 1 ? (
              <IconButton aria-label="Remove URL" onClick={() => removeUrl(index)}>
                <X size={16} />
              </IconButton>
            ) : null}
          </div>
        ))}
        {value.urls.length < MAX_LOGIN_URLS ? (
          <button
            type="button"
            className={styles.linkButton}
            onClick={() => setValue((current) => ({ ...current, urls: [...current.urls, ""] }))}
          >
            <Plus size={12} aria-hidden="true" /> Add URL
          </button>
        ) : null}
      </div>

      {otpItems.length > 0 ? (
        <div className={styles.field}>
          <label className={styles.label} htmlFor="login-linked-otp">
            Linked OTP
          </label>
          <select
            id="login-linked-otp"
            className={styles.select}
            value={value.linkedOtpId}
            onChange={(event) => setValue({ ...value, linkedOtpId: event.target.value })}
          >
            <option value="">None</option>
            {otpItems.map((otp) => (
              <option key={otp.id} value={otp.id}>
                {otp.issuer || otp.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div className={styles.field}>
        <label className={styles.label} htmlFor="login-notes">
          Notes
        </label>
        <textarea
          id="login-notes"
          className={styles.textarea}
          value={value.notes}
          maxLength={MAX_LOGIN_NOTES_LENGTH}
          spellCheck={false}
          onChange={(event) => setValue({ ...value, notes: event.target.value })}
        />
      </div>

      <Field
        label="Tags"
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

      {generatorOpen ? (
        <PasswordGeneratorDialog
          platform={platform}
          onUse={(password) => setValue((current) => ({ ...current, password }))}
          onClose={() => setGeneratorOpen(false)}
        />
      ) : null}
    </form>
  );
}
