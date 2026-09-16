# Work checklist

Kept current by the assistant while working; one line per item, newest run first.

## 2026-09-16 · 1Password-inspired pass (target 2.3.0)

- [x] Health page as a scoreboard: gauge hero, overall strength bar, finding cards with counts
- [x] "Passkeys available" check (known passkey sites, logins without a passkey)
- [x] Coloured category tiles; API credentials and SSH keys as their own entries
- [x] Coloured initial tiles for logins without a site icon; logo header on login detail
- [x] About page: developer, networkshard.com, GitHub hett-patell, built with Claude
- [ ] Fix the ItemRow test that expects a kind icon on a login row
- [ ] Lint, tests, security build, commit, bump to 2.3.0

## Open after this run

- [ ] Google passkeys: the page script leaves conditional mediation to the browser (needs a document_start entry)
- [ ] Popup: no overview or alias UI yet
- [ ] Other alias providers (SimpleLogin, addy.io, Firefox Relay)
- [ ] Real export files for the importers (samples in docs/import-samples are synthetic)
