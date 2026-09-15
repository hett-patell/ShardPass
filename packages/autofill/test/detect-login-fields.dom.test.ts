import { beforeEach, describe, expect, it } from "vitest";

import { detectLoginFields } from "../src/detect-login-fields";

describe("detectLoginFields", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("detects a standard login form", () => {
    document.body.innerHTML = `
      <form>
        <input type="email" name="username" />
        <input type="password" name="password" />
      </form>
    `;
    const results = detectLoginFields(document);
    expect(results).toHaveLength(1);
    expect(results[0]?.usernameField?.name).toBe("username");
    expect(results[0]?.passwordField?.name).toBe("password");
    expect(results[0]?.form).not.toBeNull();
  });

  it("finds the username on a form-less page where each field sits in its own wrapper", () => {
    document.body.innerHTML = `
      <div class="card">
        <div class="field"><label>Email</label><input type="email" /></div>
        <div class="field"><label>Password</label><input type="password" /></div>
        <button type="button">Sign in</button>
      </div>
    `;
    const results = detectLoginFields(document);
    expect(results).toHaveLength(1);
    expect(results[0]?.form).toBeNull();
    expect(results[0]?.usernameField?.type).toBe("email");
  });

  it("does not take a honeypot hidden by opacity or a clip-path for the username", () => {
    document.body.innerHTML = `
      <form>
        <input type="text" name="username" style="opacity: 0" />
        <input type="text" name="fax" style="clip-path: inset(50%)" />
        <input type="email" name="email" />
        <input type="password" name="password" />
      </form>
    `;
    const results = detectLoginFields(document);
    expect(results).toHaveLength(1);
    expect(results[0]?.usernameField?.name).toBe("email");
  });

  it("reads the username field's label from the text beside it, a table cell, or a <label for>", () => {
    document.body.innerHTML = `
      <form>
        <div class="field"><span>Your email address</span><input type="text" /></div>
        <input type="password" name="pw1" />
      </form>
      <form>
        <table><tr><td>Login name</td><td><input type="text" /></td></tr>
        <tr><td>Password</td><td><input type="password" name="pw2" /></td></tr></table>
      </form>
      <form>
        <label for="u3">Account</label><input id="u3" type="text" />
        <input type="password" name="pw3" />
      </form>
      <form>
        <div><span>Search</span><input type="text" /></div>
        <input type="password" name="pw4" />
      </form>
    `;
    const results = detectLoginFields(document);
    expect(results.map((set) => [set.passwordField?.name, set.usernameField !== null])).toEqual([
      ["pw1", true],
      ["pw2", true],
      ["pw3", true],
      ["pw4", true],
    ]);
    // The first three are named; the last is only the nearest text-like field before the password.
    expect(results.slice(0, 3).map((set) => set.usernameField?.type)).toEqual([
      "text",
      "text",
      "text",
    ]);
  });

  it("detects password field without username", () => {
    document.body.innerHTML = `<input type="password" name="pwd" />`;
    const results = detectLoginFields(document);
    expect(results).toHaveLength(1);
    expect(results[0]?.usernameField).toBeNull();
  });

  it("detects text input as username by name heuristic", () => {
    document.body.innerHTML = `
      <form>
        <input type="text" name="login_email" />
        <input type="password" name="pwd" />
      </form>
    `;
    const results = detectLoginFields(document);
    expect(results[0]?.usernameField?.name).toBe("login_email");
  });

  it("returns empty for no password fields", () => {
    document.body.innerHTML = `<input type="text" name="search" />`;
    expect(detectLoginFields(document)).toHaveLength(0);
  });

  it("falls back to the nearest preceding visible text-like field when nothing is named like a username", () => {
    document.body.innerHTML = `
      <form>
        <input type="text" name="q1" />
        <input type="text" name="q2" style="display: none" />
        <input type="password" name="pwd" />
      </form>
    `;
    expect(detectLoginFields(document)[0]?.usernameField?.name).toBe("q1");
  });

  it("accepts a tel field as the username", () => {
    document.body.innerHTML = `
      <form>
        <input type="tel" name="mobile" />
        <input type="password" name="pwd" />
      </form>
    `;
    expect(detectLoginFields(document)[0]?.usernameField?.name).toBe("mobile");
  });

  it("keeps a password field detected after a show-password toggle flips it to text", () => {
    document.body.innerHTML = `
      <form>
        <input type="email" name="email" />
        <input type="password" name="pwd" />
      </form>
    `;
    const seen = new WeakSet<HTMLInputElement>();
    const [first] = detectLoginFields(document);
    const password = first?.passwordField;
    if (!password) throw new Error("expected a password field");
    seen.add(password);
    password.type = "text";
    expect(detectLoginFields(document)).toHaveLength(0);
    const again = detectLoginFields(document, { previousPasswordFields: seen });
    expect(again).toHaveLength(1);
    expect(again[0]?.passwordField?.name).toBe("pwd");
    expect(again[0]?.usernameField?.name).toBe("email");
  });

  it("treats a text field marked current-password or new-password as a password field", () => {
    document.body.innerHTML = `
      <form>
        <input type="text" name="u" autocomplete="username" />
        <input type="text" name="p" autocomplete="current-password" />
      </form>
    `;
    const results = detectLoginFields(document);
    expect(results).toHaveLength(1);
    expect(results[0]?.passwordField?.name).toBe("p");
    expect(results[0]?.usernameField?.name).toBe("u");
  });

  it("detects a username-only step: an email or username field in a form with a submit control", () => {
    document.body.innerHTML = `
      <form id="step"><input type="text" name="identifier" autocomplete="username" /><button>Next</button></form>
      <form id="contact"><input type="email" name="from" /><textarea name="message"></textarea><button>Send</button></form>
      <form id="bare"><input type="email" name="who" /></form>
    `;
    const results = detectLoginFields(document);
    expect(results).toHaveLength(1);
    expect(results[0]?.passwordField).toBeNull();
    expect(results[0]?.usernameField?.name).toBe("identifier");
    expect(results[0]?.form?.id).toBe("step");
  });

  it("adds no username-only set for a form that already has a password field", () => {
    document.body.innerHTML = `
      <form>
        <input type="email" name="email" />
        <input type="password" name="pwd" />
        <button>Sign in</button>
      </form>
    `;
    expect(detectLoginFields(document)).toHaveLength(1);
  });

  it("skips a hidden honeypot field when picking the username field", () => {
    document.body.innerHTML = `
      <form>
        <input type="text" name="username" style="display: none" />
        <input type="email" name="real_email" />
        <input type="password" name="pwd" />
      </form>
    `;
    const results = detectLoginFields(document);
    expect(results[0]?.usernameField?.name).toBe("real_email");
  });

  it("detects multiple password fields (e.g. change-password forms)", () => {
    document.body.innerHTML = `
      <form>
        <input type="password" name="current_password" />
        <input type="password" name="new_password" />
      </form>
    `;
    const results = detectLoginFields(document);
    expect(results).toHaveLength(2);
  });
});
