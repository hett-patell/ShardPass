import { createChromePlatform } from "../platform/chrome-platform";
import { createOtpFillController } from "./otp/otp-fill-controller";

const controller = createOtpFillController({
  document,
  window,
  platform: createChromePlatform(),
});

controller.start();

window.addEventListener("pagehide", () => controller.dispose(), { once: true });
