import { createChromePlatform } from "../platform/chrome-platform";
import { createDataFillController } from "./data/data-fill-controller";
import { createLoginFillController } from "./login/login-fill-controller";
import { createOtpFillController } from "./otp/otp-fill-controller";
import { createPasskeyBridge } from "./passkey/passkey-bridge";

type Controllers = Readonly<{
  otpController: ReturnType<typeof createOtpFillController>;
  loginController: ReturnType<typeof createLoginFillController>;
  passkeyBridge: ReturnType<typeof createPasskeyBridge>;
  dataFillController: ReturnType<typeof createDataFillController>;
}>;

const platform = createChromePlatform();

/**
 * Starts one controller without letting it take the others down. A page can put a controller
 * in a state its author never saw -- a getter that throws, a DOM the engine refuses to
 * measure -- and when that happened at start-up the whole content script died, so the site
 * had no ShardPass at all while every other manager worked. Each part now stands alone.
 */
function startSafely<T extends { start(): void }>(controller: T): T {
  try {
    controller.start();
  } catch {
    // This part is not available on this page; the rest of ShardPass still is.
  }
  return controller;
}

function startControllers(): Controllers {
  return {
    otpController: startSafely(createOtpFillController({ document, window, platform })),
    loginController: startSafely(createLoginFillController({ document, window, platform })),
    passkeyBridge: startSafely(createPasskeyBridge({ document, window, platform })),
    dataFillController: startSafely(createDataFillController({ document, platform })),
  };
}

function disposeControllers(controllers: Controllers): void {
  for (const controller of Object.values(controllers)) {
    try {
      controller.dispose();
    } catch {
      // Already gone, or the page took it with it; the others still get their turn.
    }
  }
}

let controllers: Controllers | null = startControllers();

window.addEventListener("pagehide", (event) => {
  // Into the back/forward cache: every open host closes on its own pagehide listener, and the
  // controllers stay so the page still has ShardPass when Back brings it straight back.
  if (event.persisted) return;
  if (controllers !== null) disposeControllers(controllers);
  controllers = null;
});

window.addEventListener("pageshow", (event) => {
  if (!event.persisted || controllers !== null) return;
  controllers = startControllers();
});
