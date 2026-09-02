import { expect, test } from "./fixtures";

test("starts the default temporary extension profile clean after Playwright launch", async ({
  extensionWorker,
  issues,
}) => {
  const startup = await extensionWorker.evaluate(async () => {
    const local = await chrome.storage.local.get(null);
    const session = await chrome.storage.session.get(null);
    return {
      localKeyCount: Object.keys(local).length,
      sessionKeyCount: Object.keys(session).length,
    };
  });

  expect(startup).toEqual({ localKeyCount: 0, sessionKeyCount: 0 });
  expect(issues).toEqual([]);
});
