// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ApiClientError, GENERIC_ERROR } from "@/shared/lib/api-client";
import { useMutation } from "./useMutation";

describe("useMutation", () => {
  it("gives the action's value and is busy while it runs", async () => {
    const { result } = renderHook(() => useMutation());
    let finish: (value: number) => void = () => undefined;
    let outcome: Promise<unknown> = Promise.resolve();
    act(() => {
      outcome = result.current.run(() => new Promise<number>((resolve) => (finish = resolve)));
    });
    expect(result.current.busy).toBe(true);
    await act(async () => finish(7));
    await expect(outcome).resolves.toEqual({ ok: true, value: 7 });
    expect(result.current).toMatchObject({ busy: false, error: "" });
  });

  it("ignores a second run while the first is in flight", async () => {
    const { result } = renderHook(() => useMutation());
    let finish: () => void = () => undefined;
    let second: Promise<unknown> = Promise.resolve();
    act(() => {
      void result.current.run(() => new Promise<void>((resolve) => (finish = resolve)));
      second = result.current.run(async () => "again");
    });
    await expect(second).resolves.toBeNull();
    await act(async () => finish());
  });

  it("keeps the user-safe message of a failure until the next run or clearError", async () => {
    const { result } = renderHook(() => useMutation());
    await act(async () => {
      await expect(result.current.run(async () => Promise.reject(new ApiClientError("CONFLICT", "That name already exists here.", 409)))).resolves.toEqual({ ok: false, error: "That name already exists here." });
    });
    expect(result.current.error).toBe("That name already exists here.");
    await act(async () => void (await result.current.run(async () => Promise.reject(new Error("internal detail")))));
    expect(result.current.error).toBe(GENERIC_ERROR);
    act(() => result.current.clearError());
    expect(result.current.error).toBe("");
  });
});
