import { createChromePlatform } from "../platform/chrome-platform";
import { createLoginFillController } from "./login/login-fill-controller";
import { createOtpFillController } from "./otp/otp-fill-controller";

const platform = createChromePlatform();

const otpController = createOtpFillController({ document, window, platform });
const loginController = createLoginFillController({ document, window, platform });

otpController.start();
loginController.start();

window.addEventListener(
  "pagehide",
  () => {
    otpController.dispose();
    loginController.dispose();
  },
  { once: true },
);
