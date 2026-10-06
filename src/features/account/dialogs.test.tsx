// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CreatedAccount, SessionState } from "@/contracts/auth";
import { ApiClientError } from "@/shared/lib/api-client";
import { NewTokenDialog, tokenFileContent } from "./NewTokenDialog";
import { SignInDialog } from "./SignInDialog";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const session: SessionState = { accounts: [], activeAccountId: null, signupMode: "open", usage: null };

function renderSignIn(overrides: Partial<Parameters<typeof SignInDialog>[0]> = {}) {
  const api = { signInWithToken: vi.fn(async () => session), createAnonymous: vi.fn(async () => ({}) as CreatedAccount) };
  const props = { open: true, onClose: vi.fn(), signupMode: "open" as const, onSignedIn: vi.fn(), onCreated: vi.fn(), api, ...overrides };
  render(<SignInDialog {...props} />);
  return { ...props, api: props.api };
}

describe("SignInDialog", () => {
  it("submits the trimmed token and reports success", async () => {
    const { api, onSignedIn } = renderSignIn();
    fireEvent.change(screen.getByPlaceholderText("40-character token"), { target: { value: "  abc  " } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Sign in with token" })));
    expect(api.signInWithToken).toHaveBeenCalledWith("abc");
    expect(onSignedIn).toHaveBeenCalledWith(session);
  });

  it("shows the server's failure message, then the lockout countdown", async () => {
    const signInWithToken = vi
      .fn()
      .mockRejectedValueOnce(new ApiClientError("INVALID_TOKEN", "Tokens are 40 characters. 4 attempts left before a lockout.", 401))
      .mockRejectedValueOnce(new ApiClientError("RATE_LIMITED", "Too many failed attempts.", 429, 30));
    renderSignIn({ api: { signInWithToken, createAnonymous: vi.fn() } });
    const submit = screen.getByRole("button", { name: "Sign in with token" });
    await act(async () => fireEvent.click(submit));
    expect(screen.getByRole("alert").textContent).toBe("Tokens are 40 characters. 4 attempts left before a lockout.");
    await act(async () => fireEvent.click(submit));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("status").textContent).toMatch(/Too many failed attempts\. Try again in 0:(30|29)\./);
    // Further submits are ignored while locked.
    await act(async () => fireEvent.click(submit));
    expect(signInWithToken).toHaveBeenCalledTimes(2);
  });

  it("shows the sign-up option for each server mode", () => {
    renderSignIn({ signupMode: "closed" });
    expect(screen.queryByRole("button", { name: "Create anonymous account" })).toBeNull();
    expect(screen.getByText(/New sign-ups are closed on this server/)).toBeTruthy();
    cleanup();
    renderSignIn({ signupMode: "invite" });
    expect(screen.getByLabelText("Invite code")).toBeTruthy();
    expect(screen.getByText("This server is invite-only. Ask the admin for a code.")).toBeTruthy();
    cleanup();
    renderSignIn();
    expect(screen.getByText("A unique name, ID and token are generated for you.")).toBeTruthy();
  });

  it("sends the invite code in upper case", async () => {
    const { api } = renderSignIn({ signupMode: "invite" });
    fireEvent.change(screen.getByLabelText("Invite code"), { target: { value: " abcd-2345 " } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Create anonymous account" })));
    expect(api.createAnonymous).toHaveBeenCalledWith("ABCD-2345");
  });
});

describe("NewTokenDialog", () => {
  const account = { id: "abcdefghjkmn", name: "anon-abcdef", token: "T".repeat(40) };

  it("cannot be dismissed and continues only after the save confirmation", () => {
    const onDone = vi.fn();
    render(<NewTokenDialog account={account} onDone={onDone} />);
    expect(screen.getByRole("dialog", { name: "Save your account token" })).toBeTruthy();
    expect(screen.getByTestId("new-token").textContent).toBe(account.token);
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(onDone).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox", { name: "I've saved my token somewhere safe" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("uses the design's .txt content", () => {
    expect(tokenFileContent(account)).toBe(`RelayFiles account\nname: anon-abcdef\nid: abcdefghjkmn\ntoken: ${"T".repeat(40)}\n`);
  });
});
