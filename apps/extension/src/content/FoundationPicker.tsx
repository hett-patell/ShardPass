import { useEffect, useRef } from "react";

export interface FoundationPickerProps {
  origin: string;
  onClose: () => void;
}

export function FoundationPicker({ origin, onClose }: FoundationPickerProps) {
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeButton.current?.focus();
  }, []);

  return (
    <section
      className="picker"
      role="region"
      aria-label="ShardPass foundation picker"
      data-shardpass-picker="foundation"
    >
      <div className="headingRow">
        <div>
          <p className="eyebrow">SHARDPASS / FOUNDATION</p>
          <h2 className="title">Site access</h2>
        </div>
        <button
          ref={closeButton}
          className="closeButton"
          type="button"
          aria-label="Close ShardPass picker"
          onClick={onClose}
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>

      <div className="originBlock">
        <span className="originLabel">ORIGIN</span>
        <span className="originValue" title={origin} aria-label={`Origin: ${origin}`}>
          {origin}
        </span>
      </div>

      <p className="status" role="status">
        Foundation only — no credentials are available.
      </p>
    </section>
  );
}
