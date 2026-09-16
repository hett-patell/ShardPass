import { OtpEditableInputSchema, type OtpEditableInput } from "@shardpass/messaging";
import { Button, Field } from "@shardpass/ui";
import { useEffect, useLayoutEffect, useState, useRef } from "react";

import { parseTags } from "../item-support";
import styles from "./OtpVaultView.module.css";

export interface OtpEditorProps {
  mode: "create" | "edit";
  value: OtpEditableInput;
  revision?: number;
  submitting: boolean;
  conflict?: boolean;
  onSubmit: (value: OtpEditableInput) => Promise<void>;
  onCancel: () => void;
  onDelete?: (opener: HTMLButtonElement) => void;
}

type FormValue = OtpEditableInput;
type Errors = Partial<Record<"label" | "secret" | "period" | "counter" | "form", string>>;

const normalizeSecret = (value: string) => value.toUpperCase().replace(/[\s-]/gu, "");
const parseInteger = (value: string, fallback: number) => {
  if (!/^\d+$/u.test(value)) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : fallback;
};

function validate(value: FormValue): Errors {
  const errors: Errors = {};
  if (value.label.trim().length === 0) errors.label = "Enter a label.";
  if (value.secret.length === 0 || !/^[A-Z2-7]+$/u.test(value.secret))
    errors.secret = "Enter a canonical Base32 secret.";
  if (value.otpType === "hotp" && value.counter === undefined)
    errors.counter = "Enter a nonnegative counter.";
  if (value.otpType !== "hotp" && value.period <= 0) errors.period = "Enter a positive period.";
  if (!OtpEditableInputSchema.safeParse(value).success)
    errors.form ??= "Review the highlighted OTP settings.";
  return errors;
}

export function OtpEditor({
  mode,
  value,
  revision,
  submitting,
  conflict = false,
  onSubmit,
  onCancel,
  onDelete,
}: OtpEditorProps) {
  const [form, setForm] = useState<FormValue>(value);
  // A code being created has no secret to conceal yet, and hiding the field behind "Reveal
  // secret" left nowhere to type it. Editing an existing one still starts concealed.
  const [secretVisible, setSecretVisible] = useState(mode === "create");
  const [secretBuffer, setSecretBuffer] = useState("");
  const [secretChanged, setSecretChanged] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  // As typed: splitting on every keystroke and re-joining with ", " moved the caret and
  // grew a space per key. Parsed once, on save, like every other form.
  const [tagText, setTagText] = useState(() => value.tags.join(", "));

  // A refresh that changes nothing about this item (another folder deleted, say) hands in a
  // new `value` object; the form resets only when the item's revision or the mode changes.
  const latestValue = useRef(value);
  latestValue.current = value;
  useEffect(() => {
    const current = latestValue.current;
    setForm(current);
    setTagText(current.tags.join(", "));
    setSecretVisible(mode === "create");
    setSecretBuffer("");
    setSecretChanged(false);
    setErrors({});
  }, [mode, revision]);

  useLayoutEffect(
    () => () => {
      const secretInput = document.getElementById("otp-secret");
      if (secretInput instanceof HTMLInputElement) secretInput.value = "";
    },
    [],
  );

  const setType = (otpType: FormValue["otpType"]) => {
    setForm((current) => {
      if (otpType === "steam")
        return {
          ...current,
          otpType,
          algorithm: "SHA1",
          digits: 5,
          period: 30,
          counter: undefined,
        };
      if (otpType === "hotp")
        return { ...current, otpType, digits: Math.max(6, current.digits), period: 0, counter: 0 };
      return {
        ...current,
        otpType,
        digits: Math.max(6, current.digits),
        period: current.period > 0 ? current.period : 30,
        counter: undefined,
      };
    });
    setErrors({});
  };

  return (
    <form
      className={styles.editor}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed: FormValue = {
          ...form,
          secret: secretChanged ? form.secret : value.secret,
          issuer: form.issuer.trim(),
          label: form.label.trim(),
          // Same rules as every other form: blanks dropped, repeats folded.
          tags: parseTags(tagText),
        };
        const nextErrors = validate(trimmed);
        setErrors(nextErrors);
        if (Object.keys(nextErrors).length === 0) void onSubmit(trimmed);
      }}
    >
      <header className={styles.editorHeader}>
        <div>
          <h3>{mode === "create" ? "Create OTP" : "Edit OTP"}</h3>
        </div>
        {mode === "edit" && onDelete ? (
          <Button
            variant="destructive"
            onClick={(event) => onDelete(event.currentTarget)}
            disabled={submitting}
          >
            Delete OTP
          </Button>
        ) : null}
      </header>

      {conflict ? (
        <p className={styles.conflict} role="alert">
          This item changed. Your attempted values are retained. Review them, then save again
          against the latest revision.
        </p>
      ) : null}
      {errors.form ? (
        <p className={styles.formError} role="alert">
          {errors.form}
        </p>
      ) : null}

      <div className={styles.fieldGrid}>
        <Field
          id="otp-issuer"
          label="Issuer"
          inputProps={{
            value: form.issuer,
            maxLength: 256,
            autoComplete: "off",
            spellCheck: false,
            onChange: (event) => setForm({ ...form, issuer: event.target.value }),
          }}
        />
        <Field
          id="otp-label"
          label="Label"
          error={errors.label}
          inputProps={{
            value: form.label,
            maxLength: 256,
            autoComplete: "off",
            spellCheck: false,
            onChange: (event) => setForm({ ...form, label: event.target.value }),
          }}
        />
        <div className={styles.secretField}>
          {secretVisible ? (
            <Field
              id="otp-secret"
              label="Secret"
              error={errors.secret}
              help="Canonical unpadded Base32. Spaces and hyphens are removed on input."
              inputProps={{
                type: "text",
                name: "otp-secret-base32",
                value: secretBuffer,
                maxLength: 1024,
                autoComplete: "off",
                autoCapitalize: "none",
                spellCheck: false,
                onChange: (event) => {
                  const secret = normalizeSecret(event.target.value);
                  setSecretBuffer(secret);
                  setSecretChanged(true);
                  setForm({ ...form, secret });
                },
              }}
            />
          ) : (
            <div className={styles.secretPlaceholder}>
              <span>Secret</span>
              <strong>
                {secretChanged || value.secret
                  ? "Secret stored in editor memory"
                  : "No secret entered"}
              </strong>
              {errors.secret ? (
                <p className={styles.secretError} role="alert">
                  {errors.secret}
                </p>
              ) : null}
            </div>
          )}
          <Button
            className={styles.revealButton}
            variant="secondary"
            aria-pressed={secretVisible}
            onClick={() => {
              if (secretVisible) {
                const secretInput = document.getElementById("otp-secret");
                if (secretInput instanceof HTMLInputElement) secretInput.value = "";
                setSecretBuffer("");
                setSecretVisible(false);
              } else {
                setSecretBuffer(secretChanged ? form.secret : value.secret);
                setSecretVisible(true);
              }
            }}
          >
            {secretVisible ? "Conceal secret" : "Reveal secret"}
          </Button>
        </div>

        <label className={styles.selectField} htmlFor="otp-type">
          <span>OTP type</span>
          <select
            id="otp-type"
            value={form.otpType}
            onChange={(event) => setType(event.target.value as FormValue["otpType"])}
          >
            <option value="totp">TOTP</option>
            <option value="hotp">HOTP</option>
            <option value="steam">Steam</option>
          </select>
        </label>
        <label className={styles.selectField} htmlFor="otp-algorithm">
          <span>Algorithm</span>
          <select
            id="otp-algorithm"
            value={form.algorithm}
            disabled={form.otpType === "steam"}
            onChange={(event) =>
              setForm({ ...form, algorithm: event.target.value as FormValue["algorithm"] })
            }
          >
            <option value="SHA1">SHA-1</option>
            <option value="SHA256">SHA-256</option>
            <option value="SHA512">SHA-512</option>
          </select>
        </label>
        <Field
          id="otp-digits"
          label="Digits"
          inputProps={{
            type: "number",
            min: form.otpType === "steam" ? 5 : 6,
            max: form.otpType === "steam" ? 5 : 10,
            value: form.digits,
            disabled: form.otpType === "steam",
            inputMode: "numeric",
            onChange: (event) =>
              setForm({ ...form, digits: parseInteger(event.target.value, form.digits) }),
          }}
        />
        {form.otpType === "hotp" ? (
          <Field
            id="otp-counter"
            label="Counter"
            error={errors.counter}
            inputProps={{
              type: "number",
              min: 0,
              value: form.counter ?? 0,
              inputMode: "numeric",
              onChange: (event) =>
                setForm({ ...form, counter: parseInteger(event.target.value, -1) }),
            }}
          />
        ) : (
          <Field
            id="otp-period"
            label="Period (seconds)"
            error={errors.period}
            inputProps={{
              type: "number",
              min: 1,
              max: 300,
              value: form.period,
              disabled: form.otpType === "steam",
              inputMode: "numeric",
              onChange: (event) =>
                setForm({ ...form, period: parseInteger(event.target.value, 0) }),
            }}
          />
        )}
        <Field
          id="otp-tags"
          label="Tags"
          help="Comma-separated, up to the vault schema limit."
          inputProps={{
            value: tagText,
            autoComplete: "off",
            spellCheck: false,
            onChange: (event) => setTagText(event.target.value),
          }}
        />
        <label className={styles.favoriteField}>
          <input
            type="checkbox"
            checked={form.favorite}
            onChange={(event) => setForm({ ...form, favorite: event.target.checked })}
          />
          Favorite
        </label>
        <label className={styles.noteField} htmlFor="otp-note">
          <span>Note</span>
          <textarea
            id="otp-note"
            value={form.note}
            maxLength={4096}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setForm({ ...form, note: event.target.value })}
          />
        </label>
      </div>

      <footer className={styles.editorActions}>
        <Button variant="ghost" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
        <Button type="submit" loading={submitting}>
          {mode === "create" ? "Save OTP" : "Save changes"}
        </Button>
      </footer>
    </form>
  );
}

export const defaultOtpInput: OtpEditableInput = {
  issuer: "",
  label: "",
  secret: "",
  otpType: "totp",
  algorithm: "SHA1",
  digits: 6,
  period: 30,
  favorite: false,
  tags: [],
  note: "",
};
