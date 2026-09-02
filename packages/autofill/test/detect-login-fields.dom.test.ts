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
    expect(results[0]?.passwordField.name).toBe("password");
    expect(results[0]?.form).not.toBeNull();
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

  it("ignores a plain text field that doesn't look like a username", () => {
    document.body.innerHTML = `
      <form>
        <input type="text" name="promo_code" />
        <input type="password" name="pwd" />
      </form>
    `;
    const results = detectLoginFields(document);
    expect(results[0]?.usernameField).toBeNull();
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
