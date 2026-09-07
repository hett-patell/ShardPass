import {
  IdentityItemSchema,
  MAX_IDENTITY_NAME_LENGTH,
  MAX_IDENTITY_NOTES_LENGTH,
  type IdentityItem,
} from "@shardpass/domain";
import { Button, Field } from "@shardpass/ui";
import { useState } from "react";

import type { ExtensionPlatform } from "../../../platform/extension-platform";
import { formatTags, newItemMetadata, parseTags, schemaErrors } from "../../item-support";
import styles from "./Form.module.css";
import { createItem, updateItem } from "./submit-item";

export interface IdentityFormProps {
  item?: IdentityItem;
  platform: Pick<ExtensionPlatform, "sendMessage">;
  onSaved: (item: IdentityItem) => void;
  onCancel: () => void;
}

interface FormValue {
  name: string;
  firstName: string;
  middleName: string;
  lastName: string;
  company: string;
  username: string;
  birthDate: string;
  email: string;
  phone: string;
  street: string;
  address2: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  passportNumber: string;
  licenseNumber: string;
  nationalId: string;
  notes: string;
  favorite: boolean;
  tags: string;
}

type FieldKey =
  | "name"
  | "firstName"
  | "middleName"
  | "lastName"
  | "company"
  | "username"
  | "birthDate"
  | "email"
  | "phone"
  | "street"
  | "address2"
  | "city"
  | "state"
  | "zip"
  | "country"
  | "passportNumber"
  | "licenseNumber"
  | "nationalId"
  | "notes"
  | "tags";
type Errors = Partial<Record<FieldKey | "form", string>>;

/** Fields the form can show a schema error beside. */
const FIELDS: readonly FieldKey[] = [
  "name",
  "firstName",
  "middleName",
  "lastName",
  "company",
  "username",
  "birthDate",
  "email",
  "phone",
  "street",
  "address2",
  "city",
  "state",
  "zip",
  "country",
  "passportNumber",
  "licenseNumber",
  "nationalId",
  "notes",
  "tags",
];

function initialValue(item?: IdentityItem): FormValue {
  return {
    name: item?.name ?? "",
    firstName: item?.firstName ?? "",
    middleName: item?.middleName ?? "",
    lastName: item?.lastName ?? "",
    company: item?.company ?? "",
    username: item?.username ?? "",
    birthDate: item?.birthDate ?? "",
    email: item?.email ?? "",
    phone: item?.phone ?? "",
    street: item?.street ?? "",
    address2: item?.address2 ?? "",
    city: item?.city ?? "",
    state: item?.state ?? "",
    zip: item?.zip ?? "",
    country: item?.country ?? "",
    passportNumber: item?.passportNumber ?? "",
    licenseNumber: item?.licenseNumber ?? "",
    nationalId: item?.nationalId ?? "",
    notes: item?.notes ?? "",
    favorite: item?.favorite ?? false,
    tags: formatTags(item?.tags ?? []),
  };
}

export function IdentityForm({ item, platform, onSaved, onCancel }: IdentityFormProps) {
  const [value, setValue] = useState<FormValue>(() => initialValue(item));
  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    const name = value.name.trim();
    const tags = parseTags(value.tags);
    const nextErrors: Errors = {};
    if (name.length === 0) nextErrors.name = "Enter a name.";

    // Optional fields are sent as undefined when blank so item.update clears them.
    const opt = (text: string) => (text.trim() === "" ? undefined : text);
    const fields = {
      name,
      firstName: value.firstName,
      middleName: opt(value.middleName),
      lastName: value.lastName,
      company: opt(value.company),
      username: opt(value.username),
      birthDate: opt(value.birthDate),
      email: value.email,
      phone: value.phone,
      street: value.street,
      address2: opt(value.address2),
      city: value.city,
      state: value.state,
      zip: value.zip,
      country: value.country,
      passportNumber: opt(value.passportNumber),
      licenseNumber: opt(value.licenseNumber),
      nationalId: opt(value.nationalId),
      notes: value.notes,
      favorite: value.favorite,
      tags,
    };
    const candidate = item
      ? { ...item, ...fields }
      : { ...newItemMetadata(), kind: "identity" as const, ...fields };
    const parsed = IdentityItemSchema.safeParse(candidate);
    if (Object.keys(nextErrors).length === 0 && !parsed.success)
      Object.assign(nextErrors, schemaErrors(parsed.error.issues, FIELDS));
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSubmitting(true);
    const result = item
      ? await updateItem(platform, item.id, item.revision, fields)
      : await createItem(platform, candidate);
    setSubmitting(false);
    if (result.status === "saved" && result.item.kind === "identity") {
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
        <h2 className={styles.title}>{item ? "Edit identity" : "New identity"}</h2>
      </header>

      {errors.form ? (
        <p className={styles.formError} role="alert">
          {errors.form}
        </p>
      ) : null}

      <Field
        label="Name"
        help="A label for this identity entry, e.g. “Personal ID”."
        error={errors.name}
        inputProps={{
          autoFocus: true,
          value: value.name,
          maxLength: MAX_IDENTITY_NAME_LENGTH,
          autoComplete: "off",
          onChange: (event) => setValue({ ...value, name: event.target.value }),
        }}
      />

      <div className={styles.grid}>
        <Field
          label="First name"
          error={errors.firstName}
          inputProps={{
            value: value.firstName,
            autoComplete: "given-name",
            onChange: (event) => setValue({ ...value, firstName: event.target.value }),
          }}
        />
        <Field
          label="Middle name"
          error={errors.middleName}
          inputProps={{
            value: value.middleName,
            autoComplete: "additional-name",
            onChange: (event) => setValue({ ...value, middleName: event.target.value }),
          }}
        />
        <Field
          label="Last name"
          error={errors.lastName}
          inputProps={{
            value: value.lastName,
            autoComplete: "family-name",
            onChange: (event) => setValue({ ...value, lastName: event.target.value }),
          }}
        />
      </div>

      <div className={styles.grid}>
        <Field
          label="Company"
          error={errors.company}
          inputProps={{
            value: value.company,
            autoComplete: "organization",
            onChange: (event) => setValue({ ...value, company: event.target.value }),
          }}
        />
        <Field
          label="Username"
          error={errors.username}
          inputProps={{
            value: value.username,
            autoComplete: "username",
            onChange: (event) => setValue({ ...value, username: event.target.value }),
          }}
        />
        <Field
          label="Date of birth"
          error={errors.birthDate}
          inputProps={{
            value: value.birthDate,
            placeholder: "YYYY-MM-DD",
            autoComplete: "bday",
            onChange: (event) => setValue({ ...value, birthDate: event.target.value }),
          }}
        />
      </div>

      <div className={styles.grid}>
        <Field
          label="Email"
          error={errors.email}
          inputProps={{
            type: "email",
            value: value.email,
            autoComplete: "email",
            onChange: (event) => setValue({ ...value, email: event.target.value }),
          }}
        />
        <Field
          label="Phone"
          error={errors.phone}
          inputProps={{
            type: "tel",
            value: value.phone,
            autoComplete: "tel",
            onChange: (event) => setValue({ ...value, phone: event.target.value }),
          }}
        />
      </div>

      <Field
        label="Street"
        error={errors.street}
        inputProps={{
          value: value.street,
          autoComplete: "address-line1",
          onChange: (event) => setValue({ ...value, street: event.target.value }),
        }}
      />
      <Field
        label="Address line 2"
        error={errors.address2}
        inputProps={{
          value: value.address2,
          autoComplete: "address-line2",
          onChange: (event) => setValue({ ...value, address2: event.target.value }),
        }}
      />

      <div className={styles.grid}>
        <Field
          label="City"
          error={errors.city}
          inputProps={{
            value: value.city,
            autoComplete: "address-level2",
            onChange: (event) => setValue({ ...value, city: event.target.value }),
          }}
        />
        <Field
          label="State / province"
          error={errors.state}
          inputProps={{
            value: value.state,
            autoComplete: "address-level1",
            onChange: (event) => setValue({ ...value, state: event.target.value }),
          }}
        />
      </div>

      <div className={styles.grid}>
        <Field
          label="ZIP / postal code"
          error={errors.zip}
          inputProps={{
            value: value.zip,
            autoComplete: "postal-code",
            onChange: (event) => setValue({ ...value, zip: event.target.value }),
          }}
        />
        <Field
          label="Country"
          error={errors.country}
          inputProps={{
            value: value.country,
            autoComplete: "country-name",
            onChange: (event) => setValue({ ...value, country: event.target.value }),
          }}
        />
      </div>

      <div className={styles.grid}>
        <Field
          label="Passport number"
          error={errors.passportNumber}
          inputProps={{
            value: value.passportNumber,
            autoComplete: "off",
            onChange: (event) => setValue({ ...value, passportNumber: event.target.value }),
          }}
        />
        <Field
          label="Driving licence"
          error={errors.licenseNumber}
          inputProps={{
            value: value.licenseNumber,
            autoComplete: "off",
            onChange: (event) => setValue({ ...value, licenseNumber: event.target.value }),
          }}
        />
        <Field
          label="National ID"
          error={errors.nationalId}
          help="SSN, NI number, Aadhaar, and similar."
          inputProps={{
            value: value.nationalId,
            autoComplete: "off",
            onChange: (event) => setValue({ ...value, nationalId: event.target.value }),
          }}
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="identity-notes">
          Notes
        </label>
        <textarea
          id="identity-notes"
          className={styles.textarea}
          value={value.notes}
          maxLength={MAX_IDENTITY_NOTES_LENGTH}
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
