#!/usr/bin/env python3
"""Regenerates KeePass fixtures with pykeepass, an implementation independent of ours.

Everything here is synthetic; no real credentials. Argon2 cost is deliberately low so the
suite stays fast -- the parser reads cost from the file, so this does not weaken coverage.

    python3 -m venv /tmp/kdbxenv && /tmp/kdbxenv/bin/pip install pykeepass
    /tmp/kdbxenv/bin/python generate.py

Note: pykeepass cannot rebuild the compression_flags header field, so every fixture is
gzip-compressed. The uncompressed branch is covered by a unit test instead.
"""
import pathlib, uuid
from pykeepass import create_database

HERE = pathlib.Path(__file__).parent
PASSWORD = "fixture-master-password"
KDF_UUID = {
    "argon2d":  uuid.UUID("ef636ddf-8c29-444b-91f7-a9a403e30a0c").bytes,
    "argon2id": uuid.UUID("9e298b19-56db-4773-b23d-fc3ec6f0a1e6").bytes,
}

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

def build(name, cipher="aes256", kdf="argon2id"):
    path = HERE / name
    path.unlink(missing_ok=True)
    kp = create_database(str(path), password=PASSWORD)
    dh = kp.kdbx.header.value.dynamic_header
    dh.cipher_id.data = cipher            # construct maps the name to its UUID
    params = dh.kdf_parameters.data.dict
    params["$UUID"].value = KDF_UUID[kdf]
    params["I"].value = 2                 # low cost: fixtures must stay fast
    params["M"].value = 1 << 24           # 16 MiB
    params["P"].value = 1
    populate(kp)
    kp.save()
    print(f"{name:26} {path.stat().st_size:>6}B  {cipher:8} {kdf}")

build("argon2id-aes256.kdbx")                       # mirrors the real-world header
build("argon2d-aes256.kdbx",    kdf="argon2d")
build("argon2id-chacha20.kdbx", cipher="chacha20")
