# Changelog

What changed in each release of the ShardPass extension. Versions are plain `2.x.x`: a minor
for features, a patch for fixes. The manifest version in `apps/extension/src/manifest.ts` is
the number the browser reports on the About page.

## 2.7.4

- The dashboard and the health page judged every password again on every visit, each with its
  own 1.6 MB worker. Judgements are now shared across the page and kept until the vault locks:
  with 1,000 logins a second visit to the dashboard went from 2.8 s to 0.1 s.
- The import preview drew a row per line in the file and kept redrawing it while the import
  ran. It shows the first 200 rows and steps aside for the progress bar: previewing a
  1,000-row file went from 482 ms to about 170 ms.

## 2.7.3

- `pnpm package` writes the store upload: a flat, deterministic zip of the build that passed
  the security gate, with `manifest.json` at the root, verified by unpacking it again. The
  release gate's own archive nests everything under `ShardPass-<version>/`, which Chrome
  rejects.

## 2.7.2

- Store readiness: the extension has icons. The toolbar button, the extensions page and a
  store listing now draw the ShardPass mark at 16, 32, 48 and 128 pixels instead of a generic
  puzzle piece. The build scanner checks that every declared icon is a packaged PNG that
  exists in the build.
- `homepage_url` points at the repository, and the description says what ShardPass does rather
  than calling itself a foundation.
- A privacy policy (`docs/privacy-policy.md`) written from the actual data flows: what is
  stored where, the three features that can reach the network and what each one sends.
- The release checklist no longer demands a permission set from three releases ago, and gained
  a store-listing section.
- The item detail reads as a record: a label beside its value rather than five all-caps labels
  stacked over five short values. Edit is the primary action and Delete no longer stands
  beside it as an equal.
- The popup hides categories holding nothing, so the list shows what you have.

## 2.7.1

- The detail panel stopped telling people to select an item when the list beside it was empty.

## 2.7.0

- The dashboard is a queue of what to fix, ordered by what a finding costs to ignore, each row
  naming the accounts it covers and opening the health page at that finding. "No second
  factor" became a footnote: it matched every login, so it could not say where to start.
- The seven item-kind tiles became one composition bar in the sidebar's own colours, and an
  empty vault is an invitation rather than a grid of zeros.
- Health is a summary strip over a worklist of bands in severity order, with the affected
  accounts under each finding, instead of six tinted metric tiles.
- The generated password takes the room its surface has — 28px on the vault page, 18px in the
  popup — with digits and symbols picked out of the letters.

## 2.6.x

- Settings scrolled twice: a visually-hidden file input with no offsets stretched the document
  past the viewport. Pinned, and every settings card is a containing block now.
- Locking, the PIN and the master password became three cards instead of one card three times
  the height of its neighbours, and their fields gained labels above their controls.
- About says what ShardPass keeps, how the vault is protected, what leaves the device, and the
  keyboard shortcuts as the browser actually has them.
- The interface had been rendering at 87.5% of its own design: the root was 14px while every
  size token is written against 16px. Fixed, with a test pinning it.
- Ente sync worked again. A lazy `import()` added in 2.5.3 never resolved, because `import()`
  is disallowed in a service worker by the HTML specification; the scanner now catches that
  class of change.
- One-time codes: the picker fills again (its class was missing from the group that takes
  clicks), and a new code takes its secret straight away.

## 2.5.x

- Passkeys: ShardPass answers a site's request itself instead of letting the browser offer a
  phone over Bluetooth, and a modal request keeps asking while the isolated half loads.
- The popup finishes a clipboard clear it could not finish while closed.
- Gates: the source secret scan runs again as part of the build, `console.error`/`warn` are
  held to the vendor chunk, runtime dependencies are pinned, and `dist` is compared against a
  clean build.

## 2.4.x

- Passkeys answer a page's conditional request.
- The findings of the September audit closed across the background, the interface and the
  build.

## 2.3.x

- A health scoreboard with passkey-ready sites, category colours, name initials, and an About
  page.
- Card network marks in lists and details.

## 2.2.0

- An overview page with a health gauge and site logos in the lists.

## 2.1.0

- A Tools section with the password and username generators and DuckDuckGo email aliases.
- Breach verdicts are remembered until the password changes.
- Importers match the files the other managers actually write, with sample files under
  `docs/import-samples`.
- Three-part version numbers from here on.

## 2.0.x

The rebuild: an encrypted local-first vault, autofill and save prompts, one-time codes,
passkeys, the popup and the vault page, importers, encrypted backups, Ente sync, and the
security gates that hold all of it.
