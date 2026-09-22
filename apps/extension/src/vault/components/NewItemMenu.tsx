import type { VaultItemKind } from "@shardpass/domain";
import { Button } from "@shardpass/ui";
import {
  CreditCard,
  Globe,
  KeyRound,
  Lock,
  Plus,
  StickyNote,
  User,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

import styles from "./NewItemMenu.module.css";

interface NewItemOption {
  icon: LucideIcon;
  kind: VaultItemKind;
  label: string;
}

const OPTIONS: readonly NewItemOption[] = [
  { kind: "login", label: "Login", icon: Globe },
  { kind: "otp", label: "One-time code", icon: KeyRound },
  { kind: "note", label: "Note", icon: StickyNote },
  { kind: "card", label: "Card", icon: CreditCard },
  { kind: "identity", label: "Identity", icon: User },
  { kind: "secret", label: "Secret", icon: Lock },
];

export interface NewItemMenuProps {
  onSelect: (kind: VaultItemKind) => void;
}

/** Dropdown trigger for creating a new item, letting the user pick a kind first. */
export function NewItemMenu({ onSelect }: NewItemMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const menuItems = () =>
    Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);

  useEffect(() => {
    if (!open) return;
    // Opening hands focus to the first choice, so the menu can be worked from the keyboard.
    menuItems()[0]?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const moveFocus = (event: ReactKeyboardEvent<HTMLUListElement>) => {
    const items = menuItems();
    if (items.length === 0) return;
    const current = items.indexOf(event.target as HTMLButtonElement);
    let next: number;
    switch (event.key) {
      case "ArrowDown":
        next = current >= items.length - 1 ? 0 : current + 1;
        break;
      case "ArrowUp":
        next = current <= 0 ? items.length - 1 : current - 1;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = items.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    items[next]?.focus();
  };

  return (
    <div className={styles.container} ref={containerRef}>
      {open ? (
        <ul
          className={styles.menu}
          role="menu"
          aria-label="New item"
          ref={menuRef}
          onKeyDown={moveFocus}
        >
          {OPTIONS.map(({ kind, label, icon: Icon }) => (
            <li key={kind} role="none">
              <button
                type="button"
                role="menuitem"
                className={styles.menuItem}
                onClick={() => {
                  setOpen(false);
                  onSelect(kind);
                }}
              >
                <Icon size={14} aria-hidden="true" />
                <span>{label}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <Button
        ref={triggerRef}
        variant="secondary"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Plus size={16} aria-hidden="true" />
        <span>New item</span>
      </Button>
    </div>
  );
}
