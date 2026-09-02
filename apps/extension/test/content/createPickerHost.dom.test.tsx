import "@testing-library/jest-dom/vitest";

import { readFile } from "node:fs/promises";
import path from "node:path";

import { act } from "react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createPickerHost } from "../../src/content/createPickerHost";

const extensionRoot = path.resolve(process.cwd(), "apps/extension");
// Capture the native method before each test temporarily replaces the prototype method.
// eslint-disable-next-line @typescript-eslint/unbound-method
const originalAttachShadow = HTMLElement.prototype.attachShadow;
const openHandles = new Set<ReturnType<typeof createPickerHost>>();
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function installClosedShadowCapture(): ShadowRoot[] {
  const roots: ShadowRoot[] = [];
  vi.spyOn(HTMLElement.prototype, "attachShadow").mockImplementation(function (
    this: HTMLElement,
    init,
  ) {
    const root = originalAttachShadow.call(this, init);
    roots.push(root);
    return root;
  });
  return roots;
}

function makeAnchor(ownerDocument: Document = document): HTMLButtonElement {
  const anchor = ownerDocument.createElement("button");
  anchor.textContent = "Open ShardPass";
  ownerDocument.body.append(anchor);
  anchor.focus();
  return anchor;
}

function makeBrowsingContext(): { document: Document; window: Window } {
  const frame = document.createElement("iframe");
  document.body.append(frame);
  const ownerDocument = frame.contentDocument;
  const ownerWindow = frame.contentWindow;
  if (ownerDocument === null || ownerWindow === null) {
    throw new Error("jsdom did not create an iframe browsing context.");
  }
  return { document: ownerDocument, window: ownerWindow };
}

function openPicker(
  anchor: HTMLElement,
  options?: Readonly<{ content?: ReactNode; positionToAnchor?: boolean }>,
): ReturnType<typeof createPickerHost> {
  let handle: ReturnType<typeof createPickerHost> | undefined;
  act(() => {
    handle = createPickerHost(anchor, options);
  });
  if (handle === undefined) {
    throw new Error("Picker host was not created.");
  }
  openHandles.add(handle);
  return handle;
}

function closePicker(handle: ReturnType<typeof createPickerHost>): void {
  act(() => handle.close());
}

async function flushLifecycle(): Promise<void> {
  await act(async () => Promise.resolve());
}

afterEach(() => {
  act(() => {
    for (const handle of openHandles) {
      handle.close();
    }
  });
  openHandles.clear();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("createPickerHost", () => {
  it("creates one document-owned host with an actually closed, style-isolated shadow root", () => {
    const roots = installClosedShadowCapture();
    const anchor = makeAnchor();

    const first = openPicker(anchor);
    const second = openPicker(anchor);

    expect(first).toBe(second);
    expect(roots).toHaveLength(1);
    const host = document.body.querySelector("shardpass-picker-host");
    expect(host).toBeInstanceOf(HTMLElement);
    expect(host?.shadowRoot).toBeNull();
    expect(roots[0]?.querySelector("style")).toBeInstanceOf(HTMLStyleElement);
    expect(document.head.querySelector("style")).toBeNull();
    expect(document.querySelector("[data-shardpass-picker]")).toBeNull();
  });

  it("renders an origin as inert normalized text and exposes an accessible nonmodal region", () => {
    const roots = installClosedShadowCapture();
    const anchor = makeAnchor();
    anchor.dataset.origin = '<img src=x onerror="globalThis.compromised=true">';

    openPicker(anchor);

    const root = roots[0];
    const region = root?.querySelector('[role="region"][aria-label="ShardPass foundation picker"]');
    expect(region).toBeInstanceOf(HTMLElement);
    expect(region).not.toHaveAttribute("aria-modal");
    expect(root?.textContent).toContain(window.location.origin);
    expect(root?.querySelector("img")).toBeNull();
    expect(root?.querySelector("input, textarea, select")).toBeNull();
    expect(root?.textContent).toContain("Foundation only — no credentials are available.");
  });

  it("focuses the named close control and Escape closes, unmounts, and restores connected focus", async () => {
    const roots = installClosedShadowCapture();
    const anchor = makeAnchor();
    const handle = openPicker(anchor);
    const closeButton = roots[0]?.querySelector<HTMLButtonElement>(
      'button[aria-label="Close ShardPass picker"]',
    );

    expect(closeButton).toBeTruthy();
    expect(roots[0]?.activeElement).toBe(closeButton);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await flushLifecycle();

    expect(document.querySelector("shardpass-picker-host")).toBeNull();
    expect(anchor).toHaveFocus();
    expect(roots[0]?.childNodes).toHaveLength(0);
    expect(() => handle.close()).not.toThrow();
  });

  it("mounts caller content and positions beside the anchor with viewport flipping", () => {
    const roots = installClosedShadowCapture();
    const anchor = makeAnchor();
    vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue({
      x: 900,
      y: 700,
      top: 700,
      left: 900,
      right: 980,
      bottom: 730,
      width: 80,
      height: 30,
      toJSON: () => ({}),
    });

    const handle = openPicker(anchor, {
      content: <div data-custom-content="true">Safe metadata</div>,
      positionToAnchor: true,
    });
    const host = document.querySelector<HTMLElement>("shardpass-picker-host");

    expect(roots[0]?.querySelector("[data-custom-content='true']")).toHaveTextContent(
      "Safe metadata",
    );
    expect(host?.style.position).toBe("fixed");
    expect(host?.style.left).not.toBe("");
    expect(host?.style.top).not.toBe("");
    expect(handle.status).toBe("open");
  });

  it("bounds scroll and resize repositioning and removes listeners on close", async () => {
    vi.useFakeTimers();
    installClosedShadowCapture();
    const anchor = makeAnchor();
    const rect = vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue({
      x: 12,
      y: 12,
      top: 12,
      left: 12,
      right: 112,
      bottom: 44,
      width: 100,
      height: 32,
      toJSON: () => ({}),
    });
    const remove = vi.spyOn(window, "removeEventListener");
    const handle = openPicker(anchor, { positionToAnchor: true });

    for (let index = 0; index < 20; index += 1) {
      window.dispatchEvent(new Event("scroll"));
      window.dispatchEvent(new Event("resize"));
    }
    await vi.runAllTimersAsync();
    expect(rect.mock.calls.length).toBeLessThan(10);
    closePicker(handle);
    expect(remove).toHaveBeenCalledWith("scroll", expect.any(Function), true);
    expect(remove).toHaveBeenCalledWith("resize", expect.any(Function));
    vi.useRealTimers();
  });

  it("does not steal focus back when focus moved elsewhere or its restore target disconnected", async () => {
    installClosedShadowCapture();
    const anchor = makeAnchor();
    const other = document.createElement("button");
    document.body.append(other);
    const handle = openPicker(anchor);

    other.focus();
    closePicker(handle);
    expect(other).toHaveFocus();

    const replacementAnchor = makeAnchor();
    const replacementHandle = openPicker(replacementAnchor);
    replacementAnchor.remove();
    await flushLifecycle();
    expect(document.querySelector("shardpass-picker-host")).toBeNull();
    expect(() => replacementHandle.close()).not.toThrow();
  });

  it("recovers if the host page removes the picker host before a duplicate create call", async () => {
    const roots = installClosedShadowCapture();
    const anchor = makeAnchor();
    const first = openPicker(anchor);
    document.querySelector("shardpass-picker-host")?.remove();

    await flushLifecycle();
    const second = openPicker(anchor);

    expect(first.status).toBe("closed");
    expect(second).not.toBe(first);
    expect(second.status).toBe("open");
    expect(roots).toHaveLength(2);
    expect(document.querySelectorAll("shardpass-picker-host")).toHaveLength(1);
  });

  it("owns lifecycle listeners per browsing context and releases each document record", () => {
    installClosedShadowCapture();
    const ownerA = makeBrowsingContext();
    const ownerB = makeBrowsingContext();
    const anchorA = makeAnchor(ownerA.document);
    const anchorB = makeAnchor(ownerB.document);
    const removeA = vi.spyOn(ownerA.window, "removeEventListener");
    const firstA = openPicker(anchorA);
    const firstB = openPicker(anchorB);

    expect(firstA).not.toBe(firstB);
    expect(ownerA.document.querySelectorAll("shardpass-picker-host")).toHaveLength(1);
    expect(ownerB.document.querySelectorAll("shardpass-picker-host")).toHaveLength(1);

    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(firstA.status).toBe("open");
    expect(firstB.status).toBe("open");

    act(() => {
      ownerB.window.dispatchEvent(new Event("hashchange"));
    });
    expect(firstA.status).toBe("open");
    expect(firstB.status).toBe("closed");

    act(() => {
      ownerA.window.dispatchEvent(new Event("popstate"));
    });
    expect(firstA.status).toBe("closed");
    expect(removeA).toHaveBeenCalledWith("pagehide", expect.any(Function));
    expect(removeA).toHaveBeenCalledWith("popstate", expect.any(Function));
    expect(removeA).toHaveBeenCalledWith("hashchange", expect.any(Function));

    const secondA = openPicker(anchorA);
    expect(secondA).not.toBe(firstA);
    expect(secondA.status).toBe("open");
    expect(ownerA.document.querySelectorAll("shardpass-picker-host")).toHaveLength(1);
  });

  it("works without a defaultView through observer and explicit close", async () => {
    installClosedShadowCapture();
    const ownerDocument = document.implementation.createHTMLDocument("detached picker");
    const firstAnchor = makeAnchor(ownerDocument);
    const first = openPicker(firstAnchor);

    expect(ownerDocument.defaultView).toBeNull();
    expect(first.status).toBe("open");

    firstAnchor.remove();
    await flushLifecycle();
    expect(first.status).toBe("closed");

    const secondAnchor = makeAnchor(ownerDocument);
    const second = openPicker(secondAnchor);
    expect(second).not.toBe(first);
    expect(() => closePicker(second)).not.toThrow();
    expect(second.status).toBe("closed");
  });

  it("cleans listeners and closes on anchor removal, page lifecycle, and document navigation", async () => {
    installClosedShadowCapture();
    const removeSpy = vi.spyOn(document, "removeEventListener");
    const anchor = makeAnchor();
    const handle = openPicker(anchor);

    anchor.remove();
    await flushLifecycle();
    expect(document.querySelector("shardpass-picker-host")).toBeNull();
    expect(removeSpy).toHaveBeenCalledWith("keydown", expect.any(Function), true);

    const navigationAnchor = makeAnchor();
    openPicker(navigationAnchor);
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(document.querySelector("shardpass-picker-host")).toBeNull();

    const pageAnchor = makeAnchor();
    openPicker(pageAnchor);
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(document.querySelector("shardpass-picker-host")).toBeNull();
    expect(() => handle.close()).not.toThrow();
  });
});

describe("content entry and style packaging contracts", () => {
  it("keeps the production content entry a narrow controller bootstrap", async () => {
    const source = await readFile(path.join(extensionRoot, "src/content/main.tsx"), "utf8");

    expect(source).toContain("createOtpFillController");
    expect(source).toContain("createLoginFillController");
    expect(source).toContain("createChromePlatform");
    expect(source).toContain("otpController.start()");
    expect(source).toContain("loginController.start()");
    expect(source).toContain("otpController.dispose()");
    expect(source).toContain("loginController.dispose()");
    expect(source).not.toMatch(
      /createPickerHost|querySelector|MutationObserver|sendMessage|createRoot|fetch\s*\(|XMLHttpRequest|WebSocket|clipboard|mediaDevices|console\./,
    );
  });

  it("packages picker CSS as an isolated local string without imports or page-global selectors", async () => {
    const [hostSource, css] = await Promise.all([
      readFile(path.join(extensionRoot, "src/content/createPickerHost.tsx"), "utf8"),
      readFile(path.join(extensionRoot, "src/content/picker.css"), "utf8"),
    ]);

    expect(hostSource).toContain('from "./picker.css?raw"');
    expect(hostSource).not.toContain("dangerouslySetInnerHTML");
    expect(css).toMatch(/:host\s*\{/);
    expect(css).toContain("--z-picker: 600");
    expect(css).toContain("z-index: var(--z-picker)");
    expect(css).not.toMatch(/@import|https?:\/\/|(^|[},]\s*)(html|body)(?=[\s,{])/m);
    expect(css).not.toMatch(
      /color-mix|light-dark|oklch|@starting-style|transition-behavior|field-sizing/,
    );
  });
});
