import { test as captureTest } from "./fixtures";

captureTest.use({
  expectedRuntimeIssues: ["controlled delayed page error", "controlled delayed worker console"],
});

captureTest("automatic teardown catches delayed page and worker issues", async ({ page }) => {
  await page.goto("/tests/fixtures/sites/foundation.html?picker=off");
  await page.evaluate(() => {
    setTimeout(() => {
      throw new Error("controlled delayed page error");
    }, 0);

    const workerSource = `setTimeout(() => console.error("controlled delayed worker console"), 0);`;
    const workerUrl = URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" }));
    const worker = new Worker(workerUrl);
    Object.defineProperty(window, "__runtimeCaptureWorker", { value: worker });
  });
});
