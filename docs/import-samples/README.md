# Import samples

Synthetic export files, one per text format ShardPass imports, for trying the importer
without a real vault. Every value is made up. The column layouts follow the exports the
apps write today, cross-checked against publicly documented formats and other open-source
importers' fixtures; `packages/importers/test/samples.test.ts` runs each file through its
importer so the samples stay valid as the code changes.

| File | Source in the import dialog | Notes |
| --- | --- | --- |
| `chrome.csv` | Chrome CSV | chrome://password-manager/settings → Export passwords |
| `firefox.csv` | Firefox CSV | about:logins → ⋯ → Export Logins |
| `safari.csv` | Safari CSV | Settings → Passwords → Export; older Safari stops at Password |
| `bitwarden.json` | Bitwarden JSON | Tools → Export vault, unencrypted .json; includes an SSH key (type 5) |
| `1password.csv` | 1Password CSV | 1Password 7 style with a Type column; 1Password 8 writes only logins |
| `lastpass.csv` | LastPass CSV | Secure notes use `http://sn`; typed notes start with `NoteType:` |
| `dashlane-*.csv` | Dashlane export | Dashlane writes a ZIP holding these five CSVs; each also imports on its own |
| `nordpass.csv` | NordPass CSV | Includes a `type` column; a row with only a name is a folder |
| `protonpass.json` | Proton Pass export | The unencrypted JSON (`data.json` inside the ZIP, or bare) |
| `protonpass.csv` | Proton Pass export | The CSV keeps logins and notes only |
| `generic.csv` | Any CSV (map columns) | Arbitrary headers; map them in the dialog |

1PUX and KeePass files are archives and are not sampled here.
