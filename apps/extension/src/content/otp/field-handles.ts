export interface OtpFieldHandleRegistry {
  handleFor(input: HTMLInputElement): string;
  activate(input: HTMLInputElement): string;
  resolveActive(handle: string): HTMLInputElement | null;
  clearActive(): void;
}

export function createOtpFieldHandleRegistry(): OtpFieldHandleRegistry {
  const handles = new WeakMap<HTMLInputElement, string>();
  let active: Readonly<{ handle: string; input: HTMLInputElement }> | null = null;

  const handleFor = (input: HTMLInputElement): string => {
    const existing = handles.get(input);
    if (existing !== undefined) return existing;
    const handle = crypto.randomUUID();
    handles.set(input, handle);
    return handle;
  };

  return {
    handleFor,
    activate(input) {
      const handle = handleFor(input);
      active = { handle, input };
      return handle;
    },
    resolveActive(handle) {
      if (active?.handle !== handle || !active.input.isConnected) return null;
      return active.input;
    },
    clearActive() {
      active = null;
    },
  };
}
