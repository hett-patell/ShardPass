# Store assets

`listing.md` holds everything the Chrome Web Store form asks for. The PNGs beside it are the
listing screenshots, 1280×800, taken from a real build.

## Retaking the screenshots

They are captured by driving the packaged extension, so they show what ships rather than a
mock-up:

1. `pnpm build:security`
2. Load `dist/` unpacked in a fresh Chromium profile with a vault of a dozen realistic logins
   (never a real export: the vault in these shots is synthetic).
3. Size the window to exactly 1280×800 and capture, in order: the vault with an item open, the
   dashboard, the health page, the password generator, and settings.

Retake them whenever the interface changes in a way a viewer would notice, and keep the
captions in `listing.md` in step.
