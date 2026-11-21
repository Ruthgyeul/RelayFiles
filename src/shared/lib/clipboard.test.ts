// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText } from "./clipboard";

const setClipboard = (writeText: ((text: string) => Promise<void>) | undefined) =>
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: writeText ? { writeText } : undefined });
const setSecure = (secure: boolean) => Object.defineProperty(window, "isSecureContext", { configurable: true, value: secure });
const setExecCommand = (result: boolean | Error) =>
  Object.defineProperty(document, "execCommand", {
    configurable: true,
    value: vi.fn(() => {
      if (result instanceof Error) throw result;
      return result;
    }),
  });

afterEach(() => {
  setClipboard(undefined);
  setSecure(false);
});

describe("copyText", () => {
  it("uses the Clipboard API on a secure page", async () => {
    const writeText = vi.fn(async () => undefined);
    setClipboard(writeText);
    setSecure(true);
    setExecCommand(false);
    expect(await copyText("abc")).toBe(true);
    expect(writeText).toHaveBeenCalledWith("abc");
  });

  it("falls back to a selected textarea when the Clipboard API is missing or refuses", async () => {
    setExecCommand(true);
    expect(await copyText("lan")).toBe(true);
    setClipboard(async () => Promise.reject(new Error("denied")));
    setSecure(true);
    expect(await copyText("denied")).toBe(true);
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("reports a copy that did not happen", async () => {
    setExecCommand(false);
    expect(await copyText("x")).toBe(false);
    setExecCommand(new Error("not allowed"));
    expect(await copyText("x")).toBe(false);
  });

  it("gives focus back to the element that had it", async () => {
    const button = document.createElement("button");
    document.body.appendChild(button);
    button.focus();
    setExecCommand(true);
    await copyText("x");
    expect(document.activeElement).toBe(button);
    button.remove();
  });
});
