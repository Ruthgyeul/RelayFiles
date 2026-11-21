// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientError, GENERIC_ERROR } from "@/shared/lib/api-client";
import { useApiQuery } from "./useApiQuery";

/** A fetcher whose calls resolve or fail when the test says so. */
function controlled<T>() {
  const calls: { key: string; signal: AbortSignal; resolve: (value: T) => void; reject: (error: unknown) => void }[] = [];
  const fetcherFor = (key: string) => (_key: string, signal: AbortSignal) => new Promise<T>((resolve, reject) => calls.push({ key, signal, resolve, reject }));
  return { calls, fetcherFor };
}

afterEach(() => vi.useRealTimers());

describe("useApiQuery", () => {
  it("is idle without a key", () => {
    const fetcher = vi.fn();
    const { result } = renderHook(() => useApiQuery(null, fetcher));
    expect(result.current.status).toBe("idle");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("loads, then gives the data", async () => {
    const { calls, fetcherFor } = controlled<string>();
    const { result } = renderHook(() => useApiQuery("a", fetcherFor("a")));
    expect(result.current).toMatchObject({ status: "loading", data: null });
    await act(async () => calls[0]?.resolve("A"));
    expect(result.current).toMatchObject({ status: "ready", data: "A", error: null });
  });

  it("reports a failure with a user-safe message instead of empty data", async () => {
    const { calls, fetcherFor } = controlled<string>();
    const { result, rerender } = renderHook(({ key }) => useApiQuery(key, fetcherFor(key)), { initialProps: { key: "a" } });
    await act(async () => calls[0]?.reject(new ApiClientError("NOT_FOUND", "Not found.", 404)));
    expect(result.current).toMatchObject({ status: "error", error: "Not found.", data: null });
    rerender({ key: "b" });
    await act(async () => calls[1]?.reject(new TypeError("Failed to fetch")));
    expect(result.current).toMatchObject({ status: "error", error: GENERIC_ERROR });
  });

  it("aborts the request a new key replaces and ignores its late answer", async () => {
    const { calls, fetcherFor } = controlled<string>();
    const { result, rerender } = renderHook(({ key }) => useApiQuery(key, fetcherFor(key)), { initialProps: { key: "a" } });
    rerender({ key: "b" });
    expect(calls[0]?.signal.aborted).toBe(true);
    await act(async () => calls[0]?.resolve("A"));
    expect(result.current.status).toBe("loading");
    await act(async () => calls[1]?.resolve("B"));
    expect(result.current).toMatchObject({ status: "ready", data: "B" });
  });

  it("keeps the data on reload, and across keys only with keepPrevious", async () => {
    const { calls, fetcherFor } = controlled<string>();
    const { result, rerender } = renderHook(({ key, keep }) => useApiQuery(key, fetcherFor(key), { keepPrevious: keep }), { initialProps: { key: "a", keep: false } });
    await act(async () => calls[0]?.resolve("A"));
    act(() => result.current.reload());
    expect(result.current).toMatchObject({ status: "loading", data: "A" });
    await act(async () => calls[1]?.resolve("A2"));
    rerender({ key: "b", keep: false });
    expect(result.current).toMatchObject({ status: "loading", data: null });
    rerender({ key: "c", keep: true });
    expect(result.current).toMatchObject({ status: "loading", data: "A2" });
  });

  it("waits debounceMs after the last key change", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async () => "x");
    const { rerender } = renderHook(({ key }) => useApiQuery(key, fetcher, { debounceMs: 200 }), { initialProps: { key: "a" } });
    act(() => vi.advanceTimersByTime(150));
    rerender({ key: "ab" });
    act(() => vi.advanceTimersByTime(150));
    expect(fetcher).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(50));
    expect(fetcher).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  });
});
