import { createChromePlatform } from "../platform/chrome-platform";
import { createLoginFillController } from "./login/login-fill-controller";
import { createOtpFillController } from "./otp/otp-fill-controller";
import { createPasskeyBridge } from "./passkey/passkey-bridge";

const platform = createChromePlatform();

const otpController = createOtpFillController({ document, window, platform });
const loginController = createLoginFillController({ document, window, platform });
const passkeyBridge = createPasskeyBridge({ document, window, platform });

otpController.start();
loginController.start();
passkeyBridge.start();

window.addEventListener(
  "pagehide",
  () => {
    otpController.dispose();
    loginController.dispose();
    passkeyBridge.dispose();
  },
  { once: true },
);
