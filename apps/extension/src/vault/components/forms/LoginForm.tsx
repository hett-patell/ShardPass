import {
  LOGIN_CUSTOM_FIELD_TYPES,
  LOGIN_URL_MATCH_MODES,
  LoginItemSchema,
  MAX_LOGIN_CUSTOM_FIELDS,
  MAX_LOGIN_CUSTOM_FIELD_NAME_LENGTH,
  MAX_LOGIN_CUSTOM_FIELD_VALUE_LENGTH,
  MAX_LOGIN_NAME_LENGTH,
  MAX_LOGIN_NOTES_LENGTH,
  MAX_LOGIN_TOTP_LENGTH,
  MAX_LOGIN_URLS,
  MAX_LOGIN_URL_LENGTH,
  MAX_LOGIN_USERNAME_LENGTH,
  type LoginCustomField,
  type LoginCustomFieldType,
  type LoginItem,
  type LoginUrlMatchMode,
  type OtpItem,
  SIGN_IN_PROVIDERS,
  SIGN_IN_PROVIDER_LABELS,
  type SignInProvider,
} from "@shardpass/domain";
import { inlineTotpItem } from "@shardpass/otp";
import { Button, Field, IconButton } from "@shardpass/ui";
import { KeyRound, Plus, X } from "lucide-react";
import { useState } from "react";

import type { ExtensionPlatform } from "../../../platform/extension-platform";
import { formatTags, newItemMetadata, parseTags, schemaErrors } from "../../item-support";
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

interface CustomFieldDraft {
  name: string;
  type: LoginCustomFieldType;
  value: string;
  linkedTo: "username" | "password";
}

interface FormValue {
  name: string;
  username: string;
  password: string;
  urls: string[];
  urlMatches: LoginUrlMatchMode[];
  totp: string;
  customFields: CustomFieldDraft[];
  linkedOtpId: string;
  signInWith: string;
  notes: string;
  favorite: boolean;
  tags: string;
}

type FieldKey =
  | "name"
  | "username"
  | "password"
  | "urls"
  | "totp"
  | "customFields"
  | "notes"
  | "tags";
type Errors = Partial<Record<FieldKey | "form", string>>;

/** Fields the form can show a schema error beside. */
const FIELDS: readonly FieldKey[] = [
  "name",
  "username",
  "password",
  "urls",
  "totp",
  "customFields",
  "notes",
  "tags",
];

export const MATCH_MODE_LABELS: Record<LoginUrlMatchMode, string> = {
  domain: "Base domain",
  host: "Host only",
  startsWith: "Starts with",
  exact: "Exact URL",
  never: "Never autofill",
};

const CUSTOM_FIELD_TYPE_LABELS: Record<LoginCustomFieldType, string> = {
  text: "Text",
  hidden: "Hidden",
  boolean: "Checkbox",
  linked: "Linked",
};

function initialValue(item?: LoginItem): FormValue {
  const urls = item && item.urls.length > 0 ? [...item.urls] : [""];
  return {
    name: item?.name ?? "",
    username: item?.username ?? "",
    password: item?.password ?? "",
    urls,
    urlMatches: urls.map((_, index) => item?.urlMatches?.[index] ?? "domain"),
    totp: item?.totp ?? "",
    customFields: (item?.customFields ?? []).map((field) => ({
      name: field.name,
      type: field.type,
      value: field.value,
      linkedTo: field.linkedTo ?? "username",
    })),
    linkedOtpId: item?.linkedOtpId ?? "",
    signInWith: item?.signInWith ?? "",
    notes: item?.notes ?? "",
    favorite: item?.favorite ?? false,
    tags: formatTags(item?.tags ?? []),
  };
}

function toCustomField(draft: CustomFieldDraft): LoginCustomField {
  const name = draft.name.trim();
  if (draft.type === "linked") return { name, type: "linked", value: "", linkedTo: draft.linkedTo };
  return { name, type: draft.type, value: draft.value };
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
  const updateMatch = (index: number, next: LoginUrlMatchMode) => {
    setValue((current) => ({
      ...current,
      urlMatches: current.urlMatches.map((mode, i) => (i === index ? next : mode)),
    }));
  };
  const removeUrl = (index: number) => {
    setValue((current) => ({
      ...current,
      urls: current.urls.filter((_, i) => i !== index),
      urlMatches: current.urlMatches.filter((_, i) => i !== index),
    }));
  };
  const addUrl = () => {
    setValue((current) => ({
      ...current,
      urls: [...current.urls, ""],
      urlMatches: [...current.urlMatches, "domain"],
    }));
  };

  const updateCustomField = (index: number, patch: Partial<CustomFieldDraft>) => {
    setValue((current) => ({
      ...current,
      customFields: current.customFields.map((field, i) =>
        i === index ? { ...field, ...patch } : field,
      ),
    }));
  };
  const removeCustomField = (index: number) => {
    setValue((current) => ({
      ...current,
      customFields: current.customFields.filter((_, i) => i !== index),
    }));
  };
  const addCustomField = () => {
    setValue((current) => ({
      ...current,
      customFields: [
        ...current.customFields,
        { name: "", type: "text", value: "", linkedTo: "username" },
      ],
    }));
  };

  const submit = async () => {
    const name = value.name.trim();
    const tags = parseTags(value.tags);
    const nextErrors: Errors = {};
    if (name.length === 0) nextErrors.name = "Enter a name.";

    // URLs and their match modes are kept aligned by index; blank URLs drop their mode too.
    const kept = value.urls
      .map((url, index) => ({ url: url.trim(), mode: value.urlMatches[index] ?? "domain" }))
      .filter((entry) => entry.url.length > 0);
    const urls = kept.map((entry) => entry.url);
    const urlMatches = kept.some((entry) => entry.mode !== "domain")
      ? kept.map((entry) => entry.mode)
      : undefined;

    if (value.customFields.some((field) => field.name.trim().length === 0))
      nextErrors.customFields = "Every custom field needs a name.";
    const customFields =
      value.customFields.length > 0 ? value.customFields.map(toCustomField) : undefined;
    const totp = value.totp.trim().length > 0 ? value.totp.trim() : undefined;

    // Optional keys are always sent explicitly (value or undefined) rather than omitted:
    // item.update merges `fields` with a plain spread, where an omitted key keeps the old
    // value but an explicit `undefined` clears it. Clearing must therefore send undefined.
    const linkedOtpId = value.linkedOtpId.length > 0 ? value.linkedOtpId : undefined;
    const fields = {
      name,
      username: value.username,
      password: value.password,
      urls,
      urlMatches,
      totp,
      customFields,
      linkedOtpId,
      signInWith: (SIGN_IN_PROVIDERS as readonly string[]).includes(value.signInWith)
        ? (value.signInWith as SignInProvider)
        : undefined,
      notes: value.notes,
      favorite: value.favorite,
      tags,
    };
    const candidate = item
      ? { ...item, ...fields }
      : { ...newItemMetadata(), kind: "login" as const, ...fields };
    // The detail view generates codes from this on the page, so a secret it cannot read
    // must be refused here rather than stored.
    if (totp !== undefined && inlineTotpItem(candidate) === null)
      nextErrors.totp = "Enter a Base32 secret or an otpauth:// link.";
    const parsed = LoginItemSchema.safeParse(candidate);
    if (Object.keys(nextErrors).length === 0 && !parsed.success)
      Object.assign(nextErrors, schemaErrors(parsed.error.issues, FIELDS));
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
          autoFocus: true,
          value: value.name,
          maxLength: MAX_LOGIN_NAME_LENGTH,
          autoComplete: "off",
          onChange: (event) => setValue({ ...value, name: event.target.value }),
        }}
      />

      <Field
        label="Username"
        error={errors.username}
        inputProps={{
          value: value.username,
          maxLength: MAX_LOGIN_USERNAME_LENGTH,
          autoComplete: "username",
          onChange: (event) => setValue({ ...value, username: event.target.value }),
        }}
      />

      <SensitiveField
        label="Password"
        error={errors.password}
        value={value.password}
        onChange={(next) => setValue({ ...value, password: next })}
        extraAction={
          <IconButton aria-label="Generate password" onClick={() => setGeneratorOpen(true)}>
            <KeyRound size={16} />
          </IconButton>
        }
      />

      <div className={styles.field}>
        <span className={styles.label}>Websites</span>
        {errors.urls ? (
          <p className={styles.fieldError} role="alert">
            {errors.urls}
          </p>
        ) : null}
        {value.urls.map((url, index) => (
          <div key={index} className={styles.listRow}>
            <input
              className={styles.textInput}
              type="url"
              placeholder="https://example.com"
              maxLength={MAX_LOGIN_URL_LENGTH}
              value={url}
              aria-label={`Website ${index + 1}`}
              onChange={(event) => updateUrl(index, event.target.value)}
            />
            <select
              className={styles.select}
              aria-label={`Match rule for website ${index + 1}`}
              value={value.urlMatches[index] ?? "domain"}
              onChange={(event) => updateMatch(index, event.target.value as LoginUrlMatchMode)}
            >
              {LOGIN_URL_MATCH_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {MATCH_MODE_LABELS[mode]}
                </option>
              ))}
            </select>
            {value.urls.length > 1 ? (
              <IconButton aria-label="Remove website" onClick={() => removeUrl(index)}>
                <X size={16} />
              </IconButton>
            ) : null}
          </div>
        ))}
        {value.urls.length < MAX_LOGIN_URLS ? (
          <button type="button" className={styles.linkButton} onClick={addUrl}>
            <Plus size={12} aria-hidden="true" /> Add website
          </button>
        ) : null}
      </div>

      <SensitiveField
        label="One-time code secret"
        error={errors.totp}
        help="Paste an otpauth:// link or the Base32 secret. Codes appear on the login."
        value={value.totp}
        maxLength={MAX_LOGIN_TOTP_LENGTH}
        onChange={(next) => setValue({ ...value, totp: next })}
      />

      <div className={styles.field}>
        <label className={styles.label} htmlFor="login-sign-in-with">
          Signs in with
        </label>
        <select
          id="login-sign-in-with"
          className={styles.select}
          value={value.signInWith}
          onChange={(event) => setValue({ ...value, signInWith: event.target.value })}
        >
          <option value="">Its own password</option>
          {SIGN_IN_PROVIDERS.map((provider) => (
            <option key={provider} value={provider}>
              {provider === "other" ? "Another provider" : SIGN_IN_PROVIDER_LABELS[provider]}
            </option>
          ))}
        </select>
        <p className={styles.help}>
          For an account that uses “Continue with Google” and the like: ShardPass presses that button on the page instead of filling a password.
        </p>
      </div>

      {otpItems.length > 0 ? (
        <div className={styles.field}>
          <label className={styles.label} htmlFor="login-linked-otp">
            Linked authenticator entry
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
        <span className={styles.label}>Custom fields</span>
        {errors.customFields ? (
          <p className={styles.fieldError} role="alert">
            {errors.customFields}
          </p>
        ) : null}
        {value.customFields.map((field, index) => (
          <div key={index} className={styles.listRow}>
            <input
              className={styles.textInput}
              placeholder="Field name"
              maxLength={MAX_LOGIN_CUSTOM_FIELD_NAME_LENGTH}
              value={field.name}
              aria-label={`Custom field ${index + 1} name`}
              onChange={(event) => updateCustomField(index, { name: event.target.value })}
            />
            <select
              className={styles.select}
              aria-label={`Custom field ${index + 1} type`}
              value={field.type}
              onChange={(event) =>
                updateCustomField(index, { type: event.target.value as LoginCustomFieldType })
              }
            >
              {LOGIN_CUSTOM_FIELD_TYPES.map((type) => (
                <option key={type} value={type}>
                  {CUSTOM_FIELD_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
            {field.type === "boolean" ? (
              <label className={styles.checkboxField}>
                <input
                  type="checkbox"
                  checked={field.value === "true"}
                  aria-label={`Custom field ${index + 1} value`}
                  onChange={(event) =>
                    updateCustomField(index, { value: event.target.checked ? "true" : "false" })
                  }
                />
                On
              </label>
            ) : field.type === "linked" ? (
              <select
                className={styles.select}
                aria-label={`Custom field ${index + 1} fills with`}
                value={field.linkedTo}
                onChange={(event) =>
                  updateCustomField(index, {
                    linkedTo: event.target.value as "username" | "password",
                  })
                }
              >
                <option value="username">Fills username</option>
                <option value="password">Fills password</option>
              </select>
            ) : (
              <input
                className={styles.textInput}
                type={field.type === "hidden" ? "password" : "text"}
                placeholder="Value"
                maxLength={MAX_LOGIN_CUSTOM_FIELD_VALUE_LENGTH}
                value={field.value}
                autoComplete="off"
                aria-label={`Custom field ${index + 1} value`}
                onChange={(event) => updateCustomField(index, { value: event.target.value })}
              />
            )}
            <IconButton aria-label="Remove custom field" onClick={() => removeCustomField(index)}>
              <X size={16} />
            </IconButton>
          </div>
        ))}
        {value.customFields.length < MAX_LOGIN_CUSTOM_FIELDS ? (
          <button type="button" className={styles.linkButton} onClick={addCustomField}>
            <Plus size={12} aria-hidden="true" /> Add custom field
          </button>
        ) : null}
      </div>

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
