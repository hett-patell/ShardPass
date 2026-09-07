import { createChromePlatform } from "../platform/chrome-platform";
import { createLoginFillController } from "./login/login-fill-controller";
import { createOtpFillController } from "./otp/otp-fill-controller";
import { createPasskeyBridge } from "./passkey/passkey-bridge";

type Controllers = Readonly<{
  otpController: ReturnType<typeof createOtpFillController>;
  loginController: ReturnType<typeof createLoginFillController>;
  passkeyBridge: ReturnType<typeof createPasskeyBridge>;
}>;

const platform = createChromePlatform();

function startControllers(): Controllers {
  const otpController = createOtpFillController({ document, window, platform });
  const loginController = createLoginFillController({ document, window, platform });
  const passkeyBridge = createPasskeyBridge({ document, window, platform });
  otpController.start();
  loginController.start();
  passkeyBridge.start();
  return { otpController, loginController, passkeyBridge };
}

function disposeControllers({ otpController, loginController, passkeyBridge }: Controllers): void {
  otpController.dispose();
  loginController.dispose();
  passkeyBridge.dispose();
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
