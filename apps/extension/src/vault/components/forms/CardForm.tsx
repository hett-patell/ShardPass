import {
  CARD_BRANDS,
  CardItemSchema,
  MAX_CARD_HOLDER_LENGTH,
  MAX_CARD_NAME_LENGTH,
  MAX_CARD_NOTES_LENGTH,
  MAX_CARD_NUMBER_LENGTH,
  type CardBrand,
  type CardItem,
} from "@shardpass/domain";
import { Button, Field } from "@shardpass/ui";
import { useState } from "react";

import type { ExtensionPlatform } from "../../../platform/extension-platform";
import { formatTags, newItemMetadata, parseTags } from "../../item-support";
import styles from "./Form.module.css";
import { SensitiveField } from "./SensitiveField";
import { createItem, updateItem } from "./submit-item";

export interface CardFormProps {
  item?: CardItem;
  platform: Pick<ExtensionPlatform, "sendMessage">;
  onSaved: (item: CardItem) => void;
  onCancel: () => void;
}

interface FormValue {
  name: string;
  brand: CardBrand | "";
  cardholderName: string;
  number: string;
  expMonth: string;
  expYear: string;
  cvv: string;
  pin: string;
  notes: string;
  favorite: boolean;
  tags: string;
}

type Errors = Partial<Record<"name" | "expMonth" | "expYear" | "form", string>>;

export const CARD_BRAND_LABELS: Record<CardBrand, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "American Express",
  discover: "Discover",
  jcb: "JCB",
  unionpay: "UnionPay",
  other: "Other",
};

function initialValue(item?: CardItem): FormValue {
  return {
    name: item?.name ?? "",
    brand: item?.brand ?? "",
    cardholderName: item?.cardholderName ?? "",
    number: item?.number ?? "",
    expMonth: item?.expMonth ?? "",
    expYear: item?.expYear ?? "",
    cvv: item?.cvv ?? "",
    pin: item?.pin ?? "",
    notes: item?.notes ?? "",
    favorite: item?.favorite ?? false,
    tags: formatTags(item?.tags ?? []),
  };
}

export function CardForm({ item, platform, onSaved, onCancel }: CardFormProps) {
  const [value, setValue] = useState<FormValue>(() => initialValue(item));
  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    const name = value.name.trim();
    const tags = parseTags(value.tags);
    const nextErrors: Errors = {};
    if (name.length === 0) nextErrors.name = "Enter a name.";
    if (value.expMonth.length > 0 && !/^\d{1,2}$/u.test(value.expMonth))
      nextErrors.expMonth = "Use a two-digit month.";
    if (value.expYear.length > 0 && !/^\d{2,4}$/u.test(value.expYear))
      nextErrors.expYear = "Use a two- or four-digit year.";

    // Sent explicitly (value or undefined): item.update merges with a spread, where an
    // omitted key keeps the old value but undefined clears it.
    const fields = {
      name,
      brand: value.brand === "" ? undefined : value.brand,
      cardholderName: value.cardholderName,
      number: value.number,
      expMonth: value.expMonth,
      expYear: value.expYear,
      cvv: value.cvv,
      pin: value.pin,
      notes: value.notes,
      favorite: value.favorite,
      tags,
    };
    const candidate = item
      ? { ...item, ...fields }
      : { ...newItemMetadata(), kind: "card" as const, ...fields };
    if (Object.keys(nextErrors).length === 0 && !CardItemSchema.safeParse(candidate).success) {
      nextErrors.form = "Review the highlighted fields.";
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSubmitting(true);
    const result = item
      ? await updateItem(platform, item.id, item.revision, fields)
      : await createItem(platform, candidate);
    setSubmitting(false);
    if (result.status === "saved" && result.item.kind === "card") {
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
        <p className={styles.eyebrow}>CARD</p>
        <h2 className={styles.title}>{item ? "Edit card" : "New card"}</h2>
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
          maxLength: MAX_CARD_NAME_LENGTH,
          autoComplete: "off",
          onChange: (event) => setValue({ ...value, name: event.target.value }),
        }}
      />

      <div className={styles.field}>
        <label className={styles.label} htmlFor="card-brand">
          Brand
        </label>
        <select
          id="card-brand"
          className={styles.select}
          value={value.brand}
          onChange={(event) => setValue({ ...value, brand: event.target.value as CardBrand | "" })}
        >
          <option value="">Not set</option>
          {CARD_BRANDS.map((brand) => (
            <option key={brand} value={brand}>
              {CARD_BRAND_LABELS[brand]}
            </option>
          ))}
        </select>
      </div>

      <Field
        label="Cardholder name"
        inputProps={{
          value: value.cardholderName,
          maxLength: MAX_CARD_HOLDER_LENGTH,
          autoComplete: "cc-name",
          onChange: (event) => setValue({ ...value, cardholderName: event.target.value }),
        }}
      />

      <Field
        label="Card number"
        inputProps={{
          value: value.number,
          maxLength: MAX_CARD_NUMBER_LENGTH,
          autoComplete: "cc-number",
          inputMode: "numeric",
          onChange: (event) => setValue({ ...value, number: event.target.value }),
        }}
      />

      <div className={styles.grid}>
        <Field
          label="Expiry month"
          error={errors.expMonth}
          inputProps={{
            value: value.expMonth,
            maxLength: 2,
            inputMode: "numeric",
            placeholder: "MM",
            autoComplete: "cc-exp-month",
            onChange: (event) => setValue({ ...value, expMonth: event.target.value }),
          }}
        />
        <Field
          label="Expiry year"
          error={errors.expYear}
          inputProps={{
            value: value.expYear,
            maxLength: 4,
            inputMode: "numeric",
            placeholder: "YYYY",
            autoComplete: "cc-exp-year",
            onChange: (event) => setValue({ ...value, expYear: event.target.value }),
          }}
        />
      </div>

      <SensitiveField
        label="CVV"
        value={value.cvv}
        onChange={(next) => setValue({ ...value, cvv: next })}
      />
      <SensitiveField
        label="PIN"
        value={value.pin}
        onChange={(next) => setValue({ ...value, pin: next })}
      />

      <div className={styles.field}>
        <label className={styles.label} htmlFor="card-notes">
          Notes
        </label>
        <textarea
          id="card-notes"
          className={styles.textarea}
          value={value.notes}
          maxLength={MAX_CARD_NOTES_LENGTH}
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
    </form>
  );
}
