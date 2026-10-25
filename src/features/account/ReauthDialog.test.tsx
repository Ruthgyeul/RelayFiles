// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch, ApiClientError } from "@/shared/lib/api-client";
import { ReauthDialog, ReauthGate } from "./ReauthDialog";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("ReauthDialog", () => {
  it("confirms with the trimmed token and shows a wrong token's message", async () => {
    const reauthenticate = vi.fn().mockRejectedValueOnce(new ApiClientError("INVALID_TOKEN", "No account matches this token.", 401)).mockResolvedValueOnce(undefined);
    const onConfirmed = vi.fn();
    render(<ReauthDialog open onConfirmed={onConfirmed} onCancel={vi.fn()} api={{ reauthenticate }} />);
    fireEvent.change(screen.getByPlaceholderText("40-character token"), { target: { value: "  tok  " } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Confirm" })));
    expect(screen.getByRole("alert").textContent).toBe("No account matches this token.");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Confirm" })));
    expect(reauthenticate).toHaveBeenLastCalledWith("tok");
    expect(onConfirmed).toHaveBeenCalledOnce();
  });
});

describe("ReauthGate", () => {
  it("sends an admin call again after the token was entered", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(reply(403, { success: false, error: "Enter your account token again to continue.", code: "REAUTH_REQUIRED" }))
      .mockResolvedValueOnce(reply(200, { success: true, data: { confirmed: true } }))
      .mockResolvedValueOnce(reply(200, { success: true, data: { deleted: true } }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ReauthGate />);
    let result: Promise<unknown> = Promise.resolve();
    await act(async () => {
      result = apiFetch("/api/admin/accounts/x", { method: "DELETE" });
    });
    fireEvent.change(await screen.findByPlaceholderText("40-character token"), { target: { value: "tok" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Confirm" })));
    await expect(result).resolves.toEqual({ deleted: true });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(["/api/admin/accounts/x", "/api/auth/reauth", "/api/admin/accounts/x"]);
  });

  it("gives the original error back when the dialog is closed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(403, { success: false, error: "Enter your account token again to continue.", code: "REAUTH_REQUIRED" })));
    render(<ReauthGate />);
    let result: Promise<unknown> = Promise.resolve();
    await act(async () => {
      result = apiFetch("/api/admin/settings/signup", { method: "PUT", json: { mode: "closed" } }).catch((error: unknown) => error);
    });
    await act(async () => fireEvent.click(await screen.findByRole("button", { name: "Close" })));
    expect(await result).toMatchObject({ code: "REAUTH_REQUIRED" });
  });
});
