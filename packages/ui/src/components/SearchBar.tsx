import { Search } from "lucide-react";
import type { ChangeEvent } from "react";

import styles from "./SearchBar.module.css";

export interface SearchBarProps {
  autoFocus?: boolean;
  className?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  value: string;
}

export function SearchBar({
  autoFocus = false,
  className,
  onChange,
  placeholder = "Search",
  value,
}: SearchBarProps) {
  const wrapperClasses = [styles.wrapper, className].filter(Boolean).join(" ");

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    onChange(event.target.value);
  }

  return (
    <div className={wrapperClasses}>
      <Search className={styles.icon} size={16} aria-hidden="true" />
      <input
        type="search"
        className={styles.input}
        value={value}
        onChange={handleChange}
        placeholder={placeholder}
        autoFocus={autoFocus}
        aria-label={placeholder}
      />
    </div>
  );
}
