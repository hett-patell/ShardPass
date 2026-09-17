import {
  expect,
  expectNoSeriousAxeViolations,
  expectVaultReady,
  setChromiumZoom,
  stabilizePage,
  test,
} from "./fixtures";

const longCopy =
  "Local encryption, careful recovery responsibility, and the complete security foundation explanation remain available here even when localized text becomes deliberately and deterministically much longer.";

test("popup matches its native 360px visual and has no serious accessibility violations", async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 360, height: 520 });
  await page.goto(`chrome-extension://${extensionId}/popup/index.html`);
  await expectVaultReady(page);
  await stabilizePage(page);
  await expectNoSeriousAxeViolations(page);
  await expect(page).toHaveScreenshot("popup-foundation.png", {
    animations: "disabled",
    scale: "css",
  });
});

test("popup reflows at actual 200% Chromium zoom with long localized content", async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 720, height: 720 });
  await page.goto(`chrome-extension://${extensionId}/popup/index.html`);
  await expectVaultReady(page);
  await setChromiumZoom(page, 200);
  await page.evaluate((copy) => {
    const heading = document.querySelector("main h2");
    const explanation = heading?.nextElementSibling;
    const boundary = document.querySelector("main p:last-of-type");
    if (heading) heading.textContent = `${copy} Secure vault setup.`;
    if (explanation) explanation.textContent = copy;
    if (boundary) boundary.textContent = copy;
  }, longCopy);

  const action = page.getByRole("button", { name: "Open vault", exact: true });
  const liveStatus = page.getByText("Foundation ready", { exact: true });
  const metrics = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    clientHeight: document.documentElement.clientHeight,
    scrollHeight: document.documentElement.scrollHeight,
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth);
  expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);
  await expect(liveStatus).toBeVisible();

  await action.scrollIntoViewIfNeeded();
  await action.focus();
  await expect(action).toBeFocused();
  const focusBounds = await action.evaluate((element) => {
    const rectangle = element.getBoundingClientRect();
    const outline = Number.parseFloat(getComputedStyle(element).outlineWidth);
    return {
      top: rectangle.top - outline,
      left: rectangle.left - outline,
      right: rectangle.right + outline,
      bottom: rectangle.bottom + outline,
    };
  });
  expect(focusBounds.top).toBeGreaterThanOrEqual(0);
  expect(focusBounds.left).toBeGreaterThanOrEqual(0);
  expect(focusBounds.right).toBeLessThanOrEqual(await page.evaluate(() => innerWidth));
  expect(focusBounds.bottom).toBeLessThanOrEqual(await page.evaluate(() => innerHeight));

  const expectFullyContained = async (locator: typeof liveStatus): Promise<void> => {
    const bounds = await locator.evaluate((element) => {
      const rectangle = element.getBoundingClientRect();
      return {
        top: rectangle.top,
        left: rectangle.left,
        right: rectangle.right,
        bottom: rectangle.bottom,
      };
    });
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    expect(bounds.top).toBeGreaterThanOrEqual(0);
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(viewport.width);
    expect(bounds.bottom).toBeLessThanOrEqual(viewport.height);
  };

  await liveStatus.scrollIntoViewIfNeeded();
  await expectFullyContained(liveStatus);
  await action.scrollIntoViewIfNeeded();
  await expectFullyContained(action);
  await expect(action).toBeFocused();
});
