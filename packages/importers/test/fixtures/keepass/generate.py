#!/usr/bin/env python3
"""Regenerates KeePass fixtures with pykeepass, an implementation independent of ours.

Everything here is synthetic; no real credentials. Argon2 cost is deliberately low so the
suite stays fast -- the parser reads cost from the file, so this does not weaken coverage.

    python3 -m venv /tmp/kdbxenv && /tmp/kdbxenv/bin/pip install pykeepass
    /tmp/kdbxenv/bin/python generate.py            # every fixture
    /tmp/kdbxenv/bin/python generate.py extras.kdbx  # just the named ones

Note: pykeepass cannot rebuild the compression_flags header field, so every fixture is
gzip-compressed. The uncompressed branch is covered by a unit test instead.
"""
import hashlib, os, pathlib, sys, uuid
from datetime import datetime, timezone
from pykeepass import create_database

HERE = pathlib.Path(__file__).parent
PASSWORD = "fixture-master-password"
KDF_UUID = {
    "argon2d":  uuid.UUID("ef636ddf-8c29-444b-91f7-a9a403e30a0c").bytes,
    "argon2id": uuid.UUID("9e298b19-56db-4773-b23d-fc3ec6f0a1e6").bytes,
}
# Fixed so the key files are reproducible; still not a real key anywhere.
XML_KEY = bytes(range(0x10, 0x30))
RAW_KEY_FILE = b"not a key, just a small file whose SHA-256 becomes the key\n" * 3

def populate(kp):
    root = kp.root_group
    web = kp.add_group(root, "Web")
    deep = kp.add_group(web, "Banking")

    kp.add_entry(web, "GitHub", "octocat", "gh-pa55word!",
                 url="https://github.com/login", notes="Personal account")
    kp.add_entry(web, "Unicode ✓ Ünïcødé", "ünïcødé-user", "pä55wörd-✓",
                 url="https://example.test/uni", notes="Non-ASCII round trip")
    kp.add_entry(deep, "Nested Bank", "acct-holder", "vault-pin-9911",
                 url="https://bank.test", notes="Two levels deep")

    totp = kp.add_entry(web, "TOTP Service", "totp-user", "totp-pass", url="https://totp.test")
    # "otp" is a reserved KeePass field with its own accessor
    totp.otp = ("otpauth://totp/TOTP%20Service:totp-user?secret=JBSWY3DPEHPK3PXP"
                "&issuer=TOTP+Service&digits=6&period=30")

    kp.add_entry(root, "Recovery Codes", "", "", notes="line one\nline two\nline three")

    api = kp.add_entry(root, "API Credential", "svc-account", "not-the-real-key")
    api.set_custom_property("api-key", "sk-live-FIXTURE-0000", protect=True)
    api.set_custom_property("environment", "production", protect=False)

    kp.add_entry(root, "No Password", "user-only", "")

def populate_extras(kp):
    """Everything the first fixtures lack: history, attachments, times, TOTP plugins."""
    root = kp.root_group

    # History sits on the same protected-value keystream as everything after it, so an entry
    # with two older versions is followed by protected values that must still decode.
    versioned = kp.add_entry(root, "Versioned", "vers-user", "old-secret-1")
    versioned.save_history()
    versioned.password = "old-secret-2"
    versioned.save_history()
    versioned.password = "current-secret-3"
    kp.add_entry(root, "After History", "after-user", "still-readable")

    with_files = kp.add_entry(root, "With Attachments", "files-user", "files-pass")
    for index in range(2):
        binary_id = kp.add_binary(f"attachment {index}\n".encode())
        with_files.add_attachment(binary_id, f"file-{index}.txt")

    tray = kp.add_entry(root, "Tray TOTP", "tray-user", "tray-pass")
    tray.set_custom_property("TOTP Seed", "JBSWY3DPEHPK3PXP", protect=True)
    tray.set_custom_property("TOTP Settings", "30;6", protect=False)

    steam = kp.add_entry(root, "Tray Steam", "steam-user", "steam-pass")
    steam.set_custom_property("TOTP Seed", "GEZDGNBVGY3TQOJQ", protect=True)
    steam.set_custom_property("TOTP Settings", "30;S", protect=False)

    keeotp = kp.add_entry(root, "KeeOTP Service", "keeotp-user", "keeotp-pass")
    keeotp.otp = "key=JBSW%20Y3DP%20EHPK%203PXP&type=totp&step=30&size=6"

    tokened = kp.add_entry(root, "Service With Token", "svc", "svc-pass",
                           url="https://svc.test")
    tokened.set_custom_property("api token", "tok-FIXTURE-1234", protect=True)

    card = kp.add_entry(root, "Bank Visa", "cardsite-user", "4321", url="https://cards.test")
    card.set_custom_property("Card Number", "4111111111111111", protect=False)
    card.set_custom_property("CVV", "123", protect=True)
    card.set_custom_property("Expiry Month", "12", protect=False)
    card.set_custom_property("Expiry Year", "2030", protect=False)
    card.set_custom_property("Online Password", "web-pass", protect=True)

    dated = kp.add_entry(root, "Old Times", "dated-user", "dated-pass")
    dated.ctime = datetime(2021, 3, 4, 5, 6, 7, tzinfo=timezone.utc)
    dated.mtime = datetime(2022, 1, 2, 3, 4, 5, tzinfo=timezone.utc)

def write_xml_keyfile(path):
    key_hex = XML_KEY.hex().upper()
    groups = " ".join(key_hex[i:i + 8] for i in range(0, len(key_hex), 8))
    check = hashlib.sha256(XML_KEY).digest()[:4].hex().upper()
    path.write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n'
        "<KeyFile>\n\t<Meta>\n\t\t<Version>2.0</Version>\n\t</Meta>\n\t<Key>\n"
        f'\t\t<Data Hash="{check}">\n\t\t\t{groups}\n\t\t</Data>\n\t</Key>\n</KeyFile>\n'
    )

def build(name, cipher="aes256", kdf="argon2id", fill=populate, keyfile=None):
    path = HERE / name
    path.unlink(missing_ok=True)
    kp = create_database(str(path), password=PASSWORD, keyfile=keyfile)
    dh = kp.kdbx.header.value.dynamic_header
    dh.cipher_id.data = cipher            # construct maps the name to its UUID
    params = dh.kdf_parameters.data.dict
    params["$UUID"].value = KDF_UUID[kdf]
    params["I"].value = 2                 # low cost: fixtures must stay fast
    params["M"].value = 1 << 24           # 16 MiB
    params["P"].value = 1
    fill(kp)
    kp.save()
    print(f"{name:26} {path.stat().st_size:>6}B  {cipher:8} {kdf}")

def build_keyfile_fixtures():
    xml_key = HERE / "fixture.keyx"
    write_xml_keyfile(xml_key)
    build("keyfile-xml.kdbx", keyfile=str(xml_key))
    raw_key = HERE / "fixture-raw.key"
    raw_key.write_bytes(RAW_KEY_FILE)
    build("keyfile-raw.kdbx", keyfile=str(raw_key))

FIXTURES = {
    "argon2id-aes256.kdbx":   lambda: build("argon2id-aes256.kdbx"),  # mirrors the real-world header
    "argon2d-aes256.kdbx":    lambda: build("argon2d-aes256.kdbx", kdf="argon2d"),
    "argon2id-chacha20.kdbx": lambda: build("argon2id-chacha20.kdbx", cipher="chacha20"),
    "extras.kdbx":            lambda: build("extras.kdbx", fill=populate_extras),
    "keyfile":                build_keyfile_fixtures,
}

wanted = sys.argv[1:] or list(FIXTURES)
for name in wanted:
    FIXTURES[name]()
