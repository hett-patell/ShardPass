import { beforeEach, describe, expect, it } from "vitest";

import { detectLoginFields } from "../src/detect-login-fields";
import { fillLoginFields } from "../src/fill-login-fields";

describe("fillLoginFields", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("fills both username and password fields", () => {
    document.body.innerHTML = `
      <form>
        <input type="email" name="username" />
        <input type="password" name="password" />
      </form>
    `;
    const [fieldSet] = detectLoginFields(document);
    expect(fieldSet).toBeDefined();
    fillLoginFields(fieldSet!, "alice@example.com", "hunter2");

    const username = document.querySelector<HTMLInputElement>('input[name="username"]');
    const password = document.querySelector<HTMLInputElement>('input[name="password"]');
    expect(username?.value).toBe("alice@example.com");
    expect(password?.value).toBe("hunter2");
  });

  it("fills only the password field when there is no username field", () => {
    document.body.innerHTML = `<input type="password" name="pwd" />`;
    const [fieldSet] = detectLoginFields(document);
    expect(fieldSet).toBeDefined();
    fillLoginFields(fieldSet!, "alice@example.com", "hunter2");

    const password = document.querySelector<HTMLInputElement>('input[name="pwd"]');
    expect(password?.value).toBe("hunter2");
  });

  it("leaves the username field untouched when the username is empty", () => {
    document.body.innerHTML = `
      <form>
        <input type="email" name="username" value="prefilled" />
        <input type="password" name="password" />
      </form>
    `;
    const [fieldSet] = detectLoginFields(document);
    expect(fieldSet).toBeDefined();
    fillLoginFields(fieldSet!, "", "hunter2");

    const username = document.querySelector<HTMLInputElement>('input[name="username"]');
    expect(username?.value).toBe("prefilled");
  });

  it("dispatches input and change events so framework-bound listeners observe the fill", () => {
    document.body.innerHTML = `
      <form>
        <input type="email" name="username" />
        <input type="password" name="password" />
      </form>
    `;
    const [fieldSet] = detectLoginFields(document);
    expect(fieldSet).toBeDefined();

    const events: string[] = [];
    fieldSet!.passwordField.addEventListener("input", () => events.push("input"));
    fieldSet!.passwordField.addEventListener("change", () => events.push("change"));

    fillLoginFields(fieldSet!, "alice@example.com", "hunter2");

    expect(events).toEqual(["input", "change"]);
  });

  it("bypasses a React-style controlled-input value tracker", () => {
    document.body.innerHTML = `<input type="password" name="pwd" />`;
    const input = document.querySelector<HTMLInputElement>('input[name="pwd"]')!;

    // Simulate React's value tracker: it shadows the prototype's "value"
    // accessor with an own property on the instance so it can observe
    // `el.value = x` assignments, while still forwarding reads/writes to the
    // real native accessor underneath. fillLoginFields must call the
    // *prototype's* setter directly (via .call) to update the real value
    // without ever invoking this shadow setter, exactly as it needs to in a
    // real React app.
    const nativeDescriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!;
    let shadowSetterCalls = 0;
    Object.defineProperty(input, "value", {
      configurable: true,
      get(): string {
        return nativeDescriptor.get!.call(input) as string;
      },
      set(v: string) {
        shadowSetterCalls += 1;
        nativeDescriptor.set!.call(input, v);
      },
    });

    const [fieldSet] = detectLoginFields(document);
    expect(fieldSet).toBeDefined();
    fillLoginFields(fieldSet!, "", "hunter2");

    // The real underlying value was updated...
    expect(input.value).toBe("hunter2");
    // ...without ever going through the shadowing (React-style) setter.
    expect(shadowSetterCalls).toBe(0);
  });
});
