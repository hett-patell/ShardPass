import type { LoginItem, VaultItem } from "@shardpass/domain";
import { SIGN_IN_PROVIDER_LABELS } from "@shardpass/domain";
import { parseItemCrudResponseForRequest } from "@shardpass/messaging";
import { Button, SectionLabel } from "@shardpass/ui";
import { Copy, Eye, EyeOff } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import type { ExtensionPlatform } from "../../platform/extension-platform";
import { useInlineTotp } from "../../vault/components/detail/useInlineTotp";
import { KIND_LABELS, KindIcon } from "../components/KindIcon";
import { LiveCode } from "../components/LiveCode";
import { QuickAction } from "../components/QuickAction";
import type { ActiveTab } from "../hooks/useActiveTab";
import styles from "./DetailScreen.module.css";

export interface DetailScreenProps {
  itemId: string;
  platform: Pick<ExtensionPlatform, "sendMessage" | "sendOtpMessage">;
  tab: ActiveTab | null;
  tabMatches: boolean;
  filling: boolean;
  onFill: (item: LoginItem) => void;
  onCopy: (value: string, label: string) => void;
  onOpenVault: () => void;
}

type Loaded = { status: "loading" } | { status: "error" } | { status: "ready"; item: VaultItem };

/** One item, field by field, each with a copy button; secrets stay hidden until revealed. */
export function DetailScreen({ itemId, platform, tab, tabMatches, filling, onFill, onCopy, onOpenVault }: DetailScreenProps) {
  const [loaded, setLoaded] = useState<Loaded>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    const request = { version: 1 as const, kind: "item.get" as const, itemId };
    setLoaded({ status: "loading" });
    void platform
      .sendMessage(request)
      .then((candidate) => {
        if (cancelled) return;
        const parsed = parseItemCrudResponseForRequest(request, candidate);
        if (parsed.success && parsed.data.kind === "item.getResult") setLoaded({ status: "ready", item: parsed.data.item });
        else setLoaded({ status: "error" });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [itemId, platform]);

  if (loaded.status === "loading")
    return (
      <div className={styles.screen} aria-busy="true">
        <div className={styles.headerSkeleton} />
        <div className={styles.fieldSkeleton} />
        <div className={styles.fieldSkeleton} />
      </div>
    );
  if (loaded.status === "error")
    return (
      <p className={styles.error} role="alert">
        This item could not be opened. It may have been deleted.
      </p>
    );

  const item = loaded.item;
  const title = item.kind === "otp" ? item.issuer || item.label : item.name;
  const subtitle = item.kind === "otp" ? (item.issuer ? item.label : "") : item.kind === "login" ? item.username : KIND_LABELS[item.kind];

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <KindIcon kind={item.kind} size="lg" />
        <div className={styles.headerText}>
          <h2 className={styles.title}>{title}</h2>
          {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
        </div>
      </header>

      {item.kind === "login" && tab !== null ? (
        <div className={styles.primaryAction}>
          <Button className={styles.fillButton} loading={filling} disabled={!tabMatches} onClick={() => onFill(item)}>
            {tabMatches ? `Fill in ${tab.host}` : "Not for this site"}
          </Button>
        </div>
      ) : null}

      <div className={styles.fields}>
        {item.kind === "login" ? <LoginFields item={item} platform={platform} onCopy={onCopy} /> : null}
        {item.kind === "otp" ? (
          <Field label="One-time code">
            <LiveCode platform={platform} itemId={item.id} size="display" onCopy={(code) => onCopy(code, "Code")} />
          </Field>
        ) : null}
        {item.kind === "note" ? <Field label="Note"><pre className={styles.pre}>{item.content || "—"}</pre></Field> : null}
        {item.kind === "card" ? (
          <>
            <TextField label="Cardholder" value={item.cardholderName} onCopy={onCopy} />
            <SecretField label="Number" value={item.number} onCopy={onCopy} mask={maskCard} />
            <TextField label="Expires" value={[item.expMonth, item.expYear].filter(Boolean).join(" / ")} onCopy={onCopy} />
            <SecretField label="Security code" value={item.cvv} onCopy={onCopy} />
            <SecretField label="PIN" value={item.pin} onCopy={onCopy} />
          </>
        ) : null}
        {item.kind === "identity" ? (
          <>
            <TextField label="Name" value={[item.firstName, item.lastName].filter(Boolean).join(" ")} onCopy={onCopy} />
            <TextField label="Email" value={item.email} onCopy={onCopy} />
            <TextField label="Phone" value={item.phone} onCopy={onCopy} />
            <TextField label="Address" value={[item.street, item.city, item.state, item.zip, item.country].filter(Boolean).join(", ")} onCopy={onCopy} />
          </>
        ) : null}
        {item.kind === "secret" ? <SecretField label={item.secretType === "ssh_key" ? "Key" : "Value"} value={item.value} onCopy={onCopy} /> : null}
        {"notes" in item && item.notes ? <Field label="Notes"><pre className={styles.pre}>{item.notes}</pre></Field> : null}
        {item.tags.length > 0 ? (
          <Field label="Tags">
            <span className={styles.tags}>
              {item.tags.map((tag) => (
                <span key={tag} className={styles.tag}>
                  {tag}
                </span>
              ))}
            </span>
          </Field>
        ) : null}
      </div>

      <div className={styles.secondaryActions}>
        <Button variant="secondary" onClick={onOpenVault}>
          Edit in vault
        </Button>
      </div>
    </div>
  );
}

function LoginFields({
  item,
  platform,
  onCopy,
}: {
  item: LoginItem;
  platform: Pick<ExtensionPlatform, "sendOtpMessage">;
  onCopy: (value: string, label: string) => void;
}) {
  const inline = useInlineTotp(item, item.totp !== undefined);
  return (
    <>
      <TextField label="Username" value={item.username} onCopy={onCopy} />
      {item.signInWith !== undefined ? (
        <Field label="Signs in with">
          <span>{SIGN_IN_PROVIDER_LABELS[item.signInWith]}</span>
        </Field>
      ) : null}
      {item.signInWith === undefined || item.password !== "" ? (
        <SecretField label="Password" value={item.password} onCopy={onCopy} />
      ) : null}
      {item.linkedOtpId !== undefined ? (
        <Field label="One-time code">
          <LiveCode platform={platform} itemId={item.linkedOtpId} onCopy={(code) => onCopy(code, "Code")} />
        </Field>
      ) : inline.code !== null ? (
        <Field label="One-time code">
          <button type="button" className={styles.inlineCode} onClick={() => onCopy(inline.code ?? "", "Code")}>
            <span className={styles.codeText}>{inline.code}</span>
            <span className={styles.remaining}>{inline.remaining}s</span>
          </button>
        </Field>
      ) : null}
      {item.urls.map((url, index) => (
        <TextField key={`${url}-${index}`} label={index === 0 ? "Website" : `Website ${index + 1}`} value={url} onCopy={onCopy} />
      ))}
      {(item.passkeys ?? []).length > 0 ? (
        <Field label="Passkeys">
          {(item.passkeys ?? []).map((passkey) => (
            <span key={passkey.credentialId} className={styles.value}>
              {passkey.rpName ?? passkey.rpId} · {passkey.userName}
            </span>
          ))}
        </Field>
      ) : null}
      {(item.customFields ?? []).map((field, index) =>
        field.type === "hidden" ? (
          <SecretField key={`${field.name}-${index}`} label={field.name} value={field.value} onCopy={onCopy} />
        ) : field.type === "linked" ? null : (
          <TextField key={`${field.name}-${index}`} label={field.name} value={field.value} onCopy={onCopy} />
        ),
      )}
    </>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.field}>
      <SectionLabel>{label}</SectionLabel>
      <div className={styles.value}>{children}</div>
    </div>
  );
}

function TextField({ label, value, onCopy }: { label: string; value: string; onCopy: (value: string, label: string) => void }) {
  if (value === "") return null;
  return (
    <div className={styles.field}>
      <SectionLabel>{label}</SectionLabel>
      <div className={styles.valueRow}>
        <span className={styles.value}>{value}</span>
        <QuickAction aria-label={`Copy ${label.toLowerCase()}`} title="Copy" onClick={() => onCopy(value, label)}>
          <Copy size={15} />
        </QuickAction>
      </div>
    </div>
  );
}

function maskCard(value: string): string {
  const digits = value.replace(/\D/gu, "");
  return digits.length > 4 ? `•••• •••• •••• ${digits.slice(-4)}` : "••••";
}

function SecretField({
  label,
  value,
  onCopy,
  mask = () => "••••••••••••",
}: {
  label: string;
  value: string;
  onCopy: (value: string, label: string) => void;
  mask?: (value: string) => string;
}) {
  const [shown, setShown] = useState(false);
  if (value === "") return null;
  return (
    <div className={styles.field}>
      <SectionLabel>{label}</SectionLabel>
      <div className={styles.valueRow}>
        <span className={`${styles.value} ${styles.mono}`}>{shown ? value : mask(value)}</span>
        <QuickAction aria-label={shown ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`} title={shown ? "Hide" : "Show"} aria-pressed={shown} onClick={() => setShown((current) => !current)}>
          {shown ? <EyeOff size={15} /> : <Eye size={15} />}
        </QuickAction>
        <QuickAction aria-label={`Copy ${label.toLowerCase()}`} title="Copy" onClick={() => onCopy(value, label)}>
          <Copy size={15} />
        </QuickAction>
      </div>
    </div>
  );
}
