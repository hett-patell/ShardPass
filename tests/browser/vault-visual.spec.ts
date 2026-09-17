import type { Page } from "@playwright/test";

import {
  expect,
  expectNoSeriousAxeViolations,
  expectVaultReady,
  setChromiumZoom,
  stabilizePage,
  test,
} from "./fixtures";

const longSearch =
  "Search becomes available after encrypted vault items are enabled and this deliberately long localized explanation must wrap inside the search group without colliding with adjacent controls.";
const longCreate =
  "Item creation becomes available in a later project and this deliberately long localized explanation must remain visible, readable, and associated with its disabled action.";

interface Bounds {
  bottom: number;
  height: number;
  left: number;
  right: number;
  top: number;
  width: number;
}

function intersects(first: Bounds, second: Bounds): boolean {
  return (
    first.left < second.right &&
    first.right > second.left &&
    first.top < second.bottom &&
    first.bottom > second.top
  );
}

async function setEffectiveCssWidth(
  page: Page,
  targetCssWidth: 981 | 979 | 761 | 759,
  zoom: 100 | 200,
): Promise<{ effectiveCssWidth: number; physicalWidth: number }> {
  let physicalWidth = Math.round(targetCssWidth * (zoom / 100));
  await page.setViewportSize({ width: physicalWidth, height: Math.round(900 * (zoom / 100)) });
  await setChromiumZoom(page, zoom);

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const effectiveCssWidth = await page.evaluate(() => window.innerWidth);
    if (Math.abs(effectiveCssWidth - targetCssWidth) <= 1)
      return { effectiveCssWidth, physicalWidth };
    physicalWidth += Math.round((targetCssWidth - effectiveCssWidth) * (zoom / 100));
    await page.setViewportSize({ width: physicalWidth, height: Math.round(900 * (zoom / 100)) });
  }

  const effectiveCssWidth = await page.evaluate(() => window.innerWidth);
  expect(
    effectiveCssWidth,
    `physical=${physicalWidth}px, effective=${effectiveCssWidth}px, target=${targetCssWidth}px, zoom=${zoom}%`,
  ).toBeGreaterThanOrEqual(targetCssWidth - 1);
  expect(effectiveCssWidth).toBeLessThanOrEqual(targetCssWidth + 1);
  return { effectiveCssWidth, physicalWidth };
}

async function assertResponsiveCommandLayout(
  page: Page,
  targetCssWidth: 981 | 979 | 761 | 759,
  zoom: 100 | 200,
): Promise<void> {
  const viewport = await setEffectiveCssWidth(page, targetCssWidth, zoom);
  await page.evaluate(
    ({ search, create }) => {
      const searchDescription = document.querySelector<HTMLElement>("#search-availability");
      const createDescription = document.querySelector<HTMLElement>("#create-availability");
      if (searchDescription) searchDescription.textContent = search;
      if (createDescription) createDescription.textContent = create;
    },
    { search: longSearch, create: longCreate },
  );

  const result = await page.evaluate(() => {
    const search = document.querySelector<HTMLInputElement>("#vault-search");
    const create = document.querySelector<HTMLButtonElement>(
      "button[aria-describedby='create-availability']",
    );
    const searchDescription = document.querySelector<HTMLElement>("#search-availability");
    const createDescription = document.querySelector<HTMLElement>("#create-availability");
    if (!search || !create || !searchDescription || !createDescription)
      throw new Error("Command controls are missing.");
    const bounds = (element: Element) => element.getBoundingClientRect().toJSON() as Bounds;
    const descriptionMetrics = (element: HTMLElement) => {
      const style = getComputedStyle(element);
      const range = document.createRange();
      range.selectNodeContents(element);
      const lineTops = new Set(
        Array.from(range.getClientRects(), (rect) => Math.round(rect.top * 10)),
      );
      const group = element.parentElement;
      if (!group) throw new Error("Description group is missing.");
      return {
        bounds: bounds(element),
        groupBounds: bounds(group),
        lineCount: lineTops.size,
        lineHeight: Number.parseFloat(style.lineHeight),
        overflow: style.overflow,
        overflowX: style.overflowX,
        overflowY: style.overflowY,
        textOverflow: style.textOverflow,
        whiteSpace: style.whiteSpace,
      };
    };
    return {
      effectiveCssWidth: window.innerWidth,
      compactMedia: matchMedia("(max-width: 760px)").matches,
      search: bounds(search),
      create: bounds(create),
      searchDescription: descriptionMetrics(searchDescription),
      createDescription: descriptionMetrics(createDescription),
      searchDescribedBy: search.getAttribute("aria-describedby"),
      createDescribedBy: create.getAttribute("aria-describedby"),
      searchVisible:
        getComputedStyle(searchDescription).visibility !== "hidden" &&
        getComputedStyle(searchDescription).display !== "none",
      createVisible:
        getComputedStyle(createDescription).visibility !== "hidden" &&
        getComputedStyle(createDescription).display !== "none",
      horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
      listDisplay: getComputedStyle(
        document.querySelector("section[aria-labelledby='vault-items-heading']")!,
      ).display,
      detailDisplay: getComputedStyle(document.querySelector("#vault-details")!).display,
    };
  });

  for (const bounds of [
    result.search,
    result.create,
    result.searchDescription.bounds,
    result.createDescription.bounds,
  ]) {
    expect(bounds.width).toBeGreaterThan(0);
    expect(bounds.height).toBeGreaterThan(0);
  }
  expect(result.searchVisible).toBe(true);
  expect(result.createVisible).toBe(true);
  expect(result.searchDescribedBy).toBe("search-availability");
  expect(result.createDescribedBy).toBe("create-availability");
  expect(intersects(result.search, result.create)).toBe(false);
  expect(intersects(result.search, result.createDescription.bounds)).toBe(false);
  expect(intersects(result.searchDescription.bounds, result.create)).toBe(false);
  expect(intersects(result.searchDescription.bounds, result.createDescription.bounds)).toBe(false);

  for (const description of [result.searchDescription, result.createDescription]) {
    expect(description.lineCount).toBeGreaterThan(1);
    expect(description.bounds.height).toBeGreaterThan(description.lineHeight);
    expect(description.bounds.left).toBeGreaterThanOrEqual(description.groupBounds.left);
    expect(description.bounds.right).toBeLessThanOrEqual(description.groupBounds.right);
    expect(description.bounds.top).toBeGreaterThanOrEqual(description.groupBounds.top);
    expect(description.bounds.bottom).toBeLessThanOrEqual(description.groupBounds.bottom);
    expect(["visible", "clip"]).toContain(description.overflow);
    expect(["visible", "clip"]).toContain(description.overflowX);
    expect(["visible", "clip"]).toContain(description.overflowY);
    expect(description.textOverflow).not.toBe("ellipsis");
    expect(description.whiteSpace).not.toBe("nowrap");
  }

  expect(result.effectiveCssWidth).toBe(viewport.effectiveCssWidth);
  expect(
    result.horizontalOverflow,
    `physical=${viewport.physicalWidth}px, effective=${result.effectiveCssWidth}px, target=${targetCssWidth}px, zoom=${zoom}%`,
  ).toBeLessThanOrEqual(0);
  expect(result.detailDisplay).not.toBe("none");
  expect(result.compactMedia).toBe(result.effectiveCssWidth <= 760);

  if (result.compactMedia) {
    expect(result.listDisplay).toBe("none");
    await page.getByRole("button", { name: "Create item" }).scrollIntoViewIfNeeded();
    await expect(page.getByRole("region", { name: "Vault details" })).toBeVisible();
  }
}

test("vault desktop and compact layouts match reviewed visuals and pass axe", async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`chrome-extension://${extensionId}/vault/index.html`);
  await expectVaultReady(page);
  await stabilizePage(page);
  await expectNoSeriousAxeViolations(page);
  await expect(page).toHaveScreenshot("vault-desktop.png", {
    animations: "disabled",
    scale: "css",
    fullPage: true,
  });

  await page.setViewportSize({ width: 759, height: 900 });
  await expect(page.getByRole("region", { name: "Vault details" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Vault items" })).toBeHidden();
  await expect(page).toHaveScreenshot("vault-compact.png", {
    animations: "disabled",
    scale: "css",
    fullPage: true,
  });
});

test("vault command groups remain readable around responsive bounds and at 200% zoom", async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/vault/index.html`);
  await expectVaultReady(page);

  for (const width of [981, 979, 761, 759] as const)
    await assertResponsiveCommandLayout(page, width, 100);
  for (const width of [979, 759] as const) await assertResponsiveCommandLayout(page, width, 200);
});
