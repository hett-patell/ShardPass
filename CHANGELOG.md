# Changelog

What changed in each release of the ShardPass extension. Versions are plain `2.x.x`: a minor
for features, a patch for fixes. The manifest version in `apps/extension/src/manifest.ts` is
the number the browser reports on the About page.

## 2.8.4

A review of everything since 2.6.7 found ten problems, eight of them in my own speed and lock
changes. All ten are fixed, each with a test that fails on the old code.

- **The master password stayed in the vault page's memory.** The strength cache added in
  2.7.x also kept what the setup form judged -- the master password, and prefixes of it --
  and it was only cleared on lock, which setup never reaches. Caching is now opt-in and only
  the Health and Dashboard views, which judge stored logins, use it. The cache is bounded.
- **Every item stayed decrypted in the background until lock.** Reads started returning
  decrypted items in 2.7.6, and the session's "this root is authenticated" cache held the
  whole result. It now holds only what it compares: epoch, revision, root.
- **A fill counted as an edit again.** Batched "last used" stamps went through the normal
  update path, so each one bumped the login's revision: an editor open on that login got a
  conflict on save, and the login jumped to the top of Recently changed. Stamps now have their
  own operation that writes each login as it stands, with no revision, journal entry or
  conflict, so one login edited in the meantime no longer drops the others' stamps.
- **Locking waited on those stamps,** by up to a commit on a large vault, and the Lock button
  skipped them entirely. Every lock now just drops stamps not yet written: a missed "last
  used" costs nothing, and a lock must not wait on bookkeeping.
- **Change-password errors appeared on the wrong card.** They now show under the form.
- **Import rows after the first 200 could not be seen or unticked.** The preview now shows
  more on request, and in-file duplicates can be unticked in one click wherever they are.
- **An automatic lock could wipe an unlock that had just finished,** if the mutation lock was
  busy when the screen-lock event fired. It now decides inside that lock.
- **The popup could say "No login form" over a fill that happened,** when one frame's forms
  were all hidden and another frame was filling slowly. A frame with only hidden forms now
  stays silent, as a frame with no form always has; the popup's own timeout covers the rest.

## 2.8.3

- One-time codes were called three different things. The sidebar, the popup and the shared
  label map say "One-time code"; the New item menu said "OTP" and the editor said "Create OTP"
  and "Save OTP". A user who reads one name in the list and hunts for it under another is
  doing the interface's work. The menu entry, both headings and the save button now match
  every other item kind: "One-time code", "New one-time code", "Edit one-time code", "Save".
- The About page said imports come from "Chrome, 1Password, Bitwarden, LastPass and eight
  more". There are thirteen formats besides restoring your own backup, so it now says nine.
- The README still described a rebuild in progress against the 1.2.1 reference, said the
  browser suite was "nine tests" when it is sixteen spec files, and claimed this machine only
  had Node 24 when it runs the approved Node 22.14.0. It now opens with what ShardPass is,
  points at the changelog, privacy policy, store copy and architecture notes, and says how to
  load a build.
- The four quarantined one-time-code browser specs were written against a standalone OTP view
  that 932754d replaced on 2026-09-03. Their shared create helper now drives the current flow
  and creation passes again; the quarantine comment names what is still stale in each, instead
  of "the current interface arranges differently".

## 2.8.2

- Saving an item wrote to storage once per journal entry. Records were already batched; the
  journal, which a vault keeps up to 4,096 entries of, was not -- so a commit on a 1,000-item
  vault made 1,011 writes where 11 would do. In a browser each of those is a message to another
  process. Saving one field went from 3.2 s to 1.45 s, and importing 1,000 logins from 19.5 s
  to 9.9 s.
- Two safety tests counted writes to decide where to inject a fault, so batching silently
  stopped them faulting anything. They now name the write they mean ("the one that activates
  the generation") or measure the commit first.

## 2.8.1

- A fill from the popup is handed to every frame of the tab, and the first frame to answer is
  the answer the popup keeps. A frame that could not fill answered at once on three of its four
  paths, so it could beat the frame that was filling and the popup would say "no form on this
  page" over a fill that had happened. Every answer but "filled" now waits the same moment that
  one of those paths already did.

## 2.8.0

- **The gates run on their own.** A GitHub Actions workflow runs `pnpm verify`, the Playwright
  browser specs (which `pnpm test` leaves out because they need a real build and a browser),
  and `pnpm package`, on every push. Until now every gate depended on someone remembering.
- The four tests that timed out only under a full-suite run have budgets that match the work
  they do; three consecutive whole-suite runs pass clean.
- Usage stamps are written together. Every commit rewrites the whole generation -- about three
  milliseconds per item -- and the "last used" stamp after each fill was paying for one of
  those on its own. Fills within a few seconds of each other now share one write, and the
  stamps are flushed before the vault locks.
- The dashboard says the thing that cannot be undone: a forgotten master password cannot be
  recovered, and an encrypted backup is the only way back in.
- A test pins the shape of a read: one item fetches one record's bytes, a list fetches each
  record once.
- `docs/store/` holds the Chrome Web Store listing copy, the permission justifications, the
  data disclosures and five screenshots taken from a real build.

## 2.7.7

- **A vault that could not be opened.** Chrome reports some machines as screen-locked the
  whole time -- remote sessions and some Linux desktops among them -- and with "lock when the
  screen locks" on, that event landed on the unlock the person was in the middle of: it threw
  away the challenge just issued, and the derived key came back to nothing. Every attempt
  failed with "That secure request expired. Try again.", including the first one, so the vault
  could never be created either. A lock that fires on its own -- the inactivity alarm, the
  screen lock, the last page closing -- now passes over a vault that holds no key. Asking for
  a lock by the shortcut or the button still throws everything away, as it did.
- Seven more reads decrypted every record a second time after the load had already decrypted
  them: backup export, the backup preview and restore, and the Ente one-time-code writes.
- `pnpm package` can be run twice: it replaces its own output for that version instead of
  stopping at `ARCHIVE_OUTPUT_EXISTS`.
- The strength cache is emptied on every transition into a locked vault, including a lock that
  came from the background, rather than only the three a click passes through.

## 2.7.6

- Every read of the vault decrypted each record twice: authenticating a record does the whole
  of the work of reading it -- decrypt, decode, check the plaintext is canonical, parse, check
  it matches the record -- and then threw the item away, so the repository decrypted the same
  bytes again. The item now comes back from the check that produced it.
- A read no longer decrypts the change journal, which a vault keeps up to 4,096 entries of.
  The stored bytes are pinned by a hash in the manifest and the manifest is authenticated, so
  a tampered entry is still rejected; the change log decrypts what it returns, when it is
  asked for it.
- On a 1,000-item vault: listing the whole vault went from 540-760 ms to 236-259 ms, and
  importing 1,000 logins from 24.5 s to 19.5 s.

## 2.7.5

- Showing a password or a one-time code no longer reads the whole vault. Every single-item
  read verified every record in the vault first: on a 1,000-item vault that was 235-297 ms to
  fetch one login, and a one-time code paid it twice. A single read now verifies the root, the
  manifest and the one record it returns, which takes 35-59 ms. Tampering with a record is
  still caught the moment that record is read, and every read that returns the whole vault
  still checks all of it.

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
