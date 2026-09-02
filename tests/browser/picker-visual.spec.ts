import axe from "axe-core";

import { expect, stabilizePage, test } from "./fixtures";

const longHeading = "SHARDPASS / FOUNDATION REVIEW";
const longOrigin = `https://${"subdomain-".repeat(7)}example.test`;
const longStatus =
  "Foundation only — no credentials are available, and this intentionally long status remains visible and reachable at minimum-width 200% zoom.";

test("picker reflows at actual 200% tab zoom with long content and restores focus", async ({
  extensionWorker,
  page,
}) => {
  await page.setViewportSize({ width: 640, height: 560 });
  await page.goto(
    `/tests/fixtures/sites/foundation.html?picker=on&focusAnchor=on&pickerHeading=${encodeURIComponent(longHeading)}&pickerOrigin=${encodeURIComponent(longOrigin)}&pickerStatus=${encodeURIComponent(longStatus)}`,
  );
  await extensionWorker.evaluate(async () => {
    const tabs = await chrome.tabs.query({ active: true });
    const tab = tabs.find((candidate) => candidate.id !== undefined);
    if (tab?.id === undefined) throw new Error("Picker fixture tab is unavailable for zoom.");
    await chrome.tabs.setZoom(tab.id, 2);
  });
  await expect.poll(() => page.evaluate(() => Math.round(devicePixelRatio * 100))).toBe(200);
  await stabilizePage(page);

  const evidence = await page.evaluate(
    ({ expectedHeading, expectedOrigin, expectedStatus }) => {
      const shadow = window.__shardpassPickerRoot;
      if (!shadow) throw new Error("Test-only picker root capture is unavailable.");
      const host = shadow.host as HTMLElement;
      const picker = shadow.querySelector<HTMLElement>(".picker");
      const heading = shadow.querySelector<HTMLElement>(".eyebrow");
      const close = shadow.querySelector<HTMLButtonElement>(".closeButton");
      const origin = shadow.querySelector<HTMLElement>(".originValue");
      const status = shadow.querySelector<HTMLElement>(".status");
      if (!picker || !heading || !close || !origin || !status)
        throw new Error("Picker evidence nodes unavailable.");
      const hostBounds = host.getBoundingClientRect();
      const pickerBounds = picker.getBoundingClientRect();
      const viewport = visualViewport;
      if (viewport === null) throw new Error("Visual viewport evidence is unavailable.");
      const viewportLeft = viewport.offsetLeft;
      const viewportTop = viewport.offsetTop;
      const viewportRight = viewportLeft + viewport.width;
      const viewportBottom = viewportTop + viewport.height;
      const inside = (bounds: DOMRect, inset = 0) =>
        bounds.left - inset >= pickerBounds.left &&
        bounds.right + inset <= pickerBounds.right &&
        bounds.top - inset >= pickerBounds.top &&
        bounds.bottom + inset <= pickerBounds.bottom &&
        bounds.left - inset >= viewportLeft &&
        bounds.right + inset <= viewportRight &&
        bounds.top - inset >= viewportTop &&
        bounds.bottom + inset <= viewportBottom;
      const textInside = (element: HTMLElement) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        const rects = [...range.getClientRects()];
        return rects.length > 0 && rects.every((bounds) => inside(bounds));
      };
      const closeStyle = getComputedStyle(close);
      const outlineReach =
        Number.parseFloat(closeStyle.outlineWidth) + Number.parseFloat(closeStyle.outlineOffset);
      const pickerStyle = getComputedStyle(picker);
      return {
        documentOverflow:
          document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        compactWidth: pickerBounds.width <= 296,
        hostInside:
          hostBounds.left >= viewportLeft &&
          hostBounds.right <= viewportRight &&
          hostBounds.top >= viewportTop &&
          hostBounds.bottom <= viewportBottom,
        hostOverflow: host.scrollWidth <= host.clientWidth,
        pickerOverflow: picker.scrollWidth <= picker.clientWidth,
        pickerInside:
          pickerBounds.left >= viewportLeft &&
          pickerBounds.right <= viewportRight &&
          pickerBounds.top >= viewportTop &&
          pickerBounds.bottom <= viewportBottom,
        pickerClipsInternally: pickerStyle.overflowX !== "visible",
        headingComplete: heading.textContent === expectedHeading && textInside(heading),
        closeOutlineInside: inside(close.getBoundingClientRect(), outlineReach),
        closeFocused: shadow.activeElement === close,
        originComplete:
          origin.textContent === expectedOrigin &&
          origin.title === expectedOrigin &&
          origin.getAttribute("aria-label") === `Origin: ${expectedOrigin}` &&
          textInside(origin),
        originUnclipped:
          getComputedStyle(origin).textOverflow !== "ellipsis" &&
          origin.scrollWidth <= origin.clientWidth,
        statusComplete: status.textContent === expectedStatus && textInside(status),
      };
    },
    { expectedHeading: longHeading, expectedOrigin: longOrigin, expectedStatus: longStatus },
  );
  expect(evidence).toEqual({
    documentOverflow: true,
    compactWidth: true,
    hostInside: true,
    hostOverflow: true,
    pickerOverflow: true,
    pickerInside: true,
    pickerClipsInternally: true,
    headingComplete: true,
    closeOutlineInside: true,
    closeFocused: true,
    originComplete: true,
    originUnclipped: true,
    statusComplete: true,
  });

  await expect(page).toHaveScreenshot("picker-zoom-compact.png", {
    animations: "disabled",
    scale: "css",
  });
  await page.keyboard.press("Escape");
  await expect(page.locator("shardpass-picker-host")).toHaveCount(0);
  await expect(page.locator("#foundation-email")).toBeFocused();
});

test("explicit nonproduction harness renders the isolated picker visual and passes axe", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 720 });
  await page.addInitScript({ content: axe.source });
  await page.goto("/tests/fixtures/sites/foundation.html?picker=on");
  await expect(page.locator("shardpass-picker-host")).toHaveCount(1);
  await stabilizePage(page);

  const picker = page.locator("shardpass-picker-host");
  await expect(picker).toHaveScreenshot("picker-foundation.png", {
    animations: "disabled",
    scale: "css",
  });

  const audit = await page.evaluate(async () => {
    const shadow = window.__shardpassPickerRoot;
    if (!shadow) throw new Error("Test-only picker root capture is unavailable.");
    const picker = shadow.querySelector<HTMLElement>("[data-shardpass-picker='foundation']");
    if (!picker) throw new Error("Picker audit node is unavailable.");
    Object.defineProperty(shadow.host, "shadowRoot", { configurable: true, value: shadow });
    let results;
    try {
      results = await window.axe.run(
        { include: [picker] },
        {
          runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
        },
      );
    } finally {
      Reflect.deleteProperty(shadow.host, "shadowRoot");
    }
    return {
      auditedRootIsCapturedShadow:
        results.testEngine.name === "axe-core" && shadow.host.localName === "shardpass-picker-host",
      pickerNodePresent: picker?.getAttribute("aria-label") === "ShardPass foundation picker",
      auditedNodeCount: [
        ...results.passes,
        ...results.incomplete,
        ...results.inapplicable,
        ...results.violations,
      ]
        .flatMap((result) => result.nodes)
        .filter((node) => node.target.length > 0).length,
      violations: results.violations.filter(
        (violation) => violation.impact === "serious" || violation.impact === "critical",
      ),
    };
  });
  expect(audit.auditedRootIsCapturedShadow).toBe(true);
  expect(audit.pickerNodePresent).toBe(true);
  expect(audit.auditedNodeCount).toBeGreaterThan(0);
  expect(audit.violations).toEqual([]);
});
