# Legacy packaged artifact provenance

The workspace began from an unpacked ShardPass 1.2.1 Chrome Manifest V3 extension. The following paths are the preserved packaged production artifact and remain usable while the clean rebuild is incomplete:

- `manifest.json`
- `assets/`
- `icons/`
- `service-worker-loader.js`
- `src/popup/index.html`

These files are generated/minified behavioral references, not maintainable source. New code may inspect them and may generate fixtures from authorized local execution, but it must not import them into the clean source graph, edit them, or treat them as build inputs. Clean-room builds must write only to `dist/`.

The artifact may be replaced or removed only through a separately approved migration after the maintainable implementation has verified parity. Until then, preserve its path names and bytes.
