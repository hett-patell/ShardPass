# ShardPass privacy policy

Last updated 17 September 2026. This policy covers the ShardPass browser extension.

## The short version

ShardPass has no account, no server, and no analytics. Your vault is encrypted on your own
device and stays there. Three features can send anything over the network, each is off until
you turn it on, and each is described below.

## What ShardPass stores, and where

Everything you save — logins, passkeys, one-time codes, cards, identities, notes, secrets, API
credentials and SSH keys — is encrypted with a key derived from your master password
(Argon2id, 64 MiB, two passes) and written to the browser's own extension storage on that
device. The master password is never stored and never transmitted. Nobody can open the vault
without it, including the developer: there is no recovery path and no copy held anywhere else.

Settings that are not secrets — your theme, the auto-lock timer, whether breach checks are
allowed — are stored alongside it in the same local storage.

If you set a PIN, a key derived from that PIN is stored on that browser profile only, so it
never leaves the device and never syncs.

## What leaves your device

Nothing, unless you turn one of these on.

**Breach checks (off by default).** When you ask ShardPass to check a password, it sends the
first five characters of that password's SHA-1 hash to the Have I Been Pwned range API at
`api.pwnedpasswords.com`. The password, the full hash, the site and your identity are never
sent; the service returns every hash suffix sharing those five characters and the comparison
happens on your device. Have I Been Pwned's own privacy terms apply to that request.

**Ente Authenticator sync (off by default).** If you connect an Ente account, your one-time
code records — and only those — synchronise with `api.ente.io` under Ente's end-to-end
encryption, using the credentials you supply. Logins, cards, notes and everything else are
never sent. Ente's privacy policy applies to data held in your Ente account.

**DuckDuckGo email aliases (off by default).** If you supply an Email Protection token,
ShardPass asks `quack.duckduckgo.com` to generate a private `@duck.com` address when you ask
for one. The token is stored sealed under your vault key and is sent only to DuckDuckGo.
DuckDuckGo's privacy policy applies to addresses generated this way.

No other network destination is reachable: the extension's content security policy and its
build-time scanner restrict connections to exactly these hosts.

## Site icons

Icons beside your logins come from the browser's own favicon cache through the `favicon`
permission. No request is made to the sites in your vault, and no third-party icon service is
used.

## What the extension reads on web pages

The content script runs on pages you visit so it can offer to fill and to save. It reads form
fields to find where a value belongs, and the address of the page to decide which login
matches. It reports nothing anywhere: what it reads stays in the page and in messages to the
extension's own background worker. Filling and saving happen only when you click.

## Permissions, and why each exists

- `storage`, `unlimitedStorage` — hold the encrypted vault on this device.
- `alarms`, `idle` — lock the vault on your timer and when the screen locks.
- `activeTab` — read the open tab's address to suggest its login, and ask that tab to fill,
  granted only while you are using the popup.
- `contextMenus` — the "Fill login with ShardPass" entry on an editable field.
- `favicon` — the browser's cached icons for your saved sites.
- `host_permissions` — the content script that offers to fill and save on the pages you visit.

## Analytics, advertising and sale of data

There are none. ShardPass collects no usage statistics, contains no advertising or tracking
code, and there is no data to sell, share or disclose. Nothing about your use of it reaches
the developer.

## Children

ShardPass is a general-purpose tool and is not directed at children.

## Deleting your data

Uninstalling the extension removes the vault with it. You can also export an encrypted backup
first, or delete individual items, from the vault page. Data held in an Ente account is
deleted through Ente.

## Changes to this policy

Changes are committed to this file in the public repository, so the history of what this
policy has said is part of the source. Material changes will be noted in `CHANGELOG.md`.

## Contact

Het Patel, Network Shard — <https://networkshard.com> — issues and questions at
<https://github.com/hett-patell/ShardPass>.
