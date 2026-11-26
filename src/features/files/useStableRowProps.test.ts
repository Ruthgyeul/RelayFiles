// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useStableRowProps } from "./useStableRowProps";

describe("useStableRowProps", () => {
  it("keeps handlers and nested drag props identical across renders, calling the latest handler", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { result, rerender } = renderHook(({ onToggle, selected }) => useStableRowProps()("a", { selected, onToggle, drag: { draggable: true, onDragEnd: onToggle } }), {
      initialProps: { onToggle: first, selected: false },
    });
    const before = result.current;
    rerender({ onToggle: second, selected: false });
    const after = result.current;
    expect(after.onToggle).toBe(before.onToggle);
    expect(after.drag).toBe(before.drag);
    after.onToggle();
    after.drag.onDragEnd();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(2);
  });

  it("gives each row its own handlers and changes what changed", () => {
    const { result, rerender } = renderHook(({ selected }) => {
      const stable = useStableRowProps();
      return [stable("a", { selected, onToggle: () => "a", drop: { over: selected } }), stable("b", { selected: false, onToggle: () => "b" })] as const;
    }, { initialProps: { selected: false } });
    const [a, b] = result.current;
    expect(a.onToggle).not.toBe(b.onToggle);
    rerender({ selected: true });
    expect(result.current[0].selected).toBe(true);
    expect(result.current[0].drop).not.toBe(a.drop);
    expect(result.current[0].onToggle()).toBe("a");
    expect(result.current[1].onToggle()).toBe("b");
  });

  it("forgets rows the committed render no longer lists", () => {
    const { result, rerender } = renderHook(({ ids }) => {
      const stable = useStableRowProps();
      return ids.map((id) => stable(id, { onToggle: () => id }));
    }, { initialProps: { ids: ["a", "b"] } });
    const [a, b] = result.current;
    rerender({ ids: ["b"] });
    // Still listed: the same handler.
    expect(result.current[0]!.onToggle).toBe(b!.onToggle);
    rerender({ ids: ["a", "b"] });
    // Listed again after a render without it: made anew, and calls the current handler.
    expect(result.current[0]!.onToggle).not.toBe(a!.onToggle);
    expect(result.current[0]!.onToggle()).toBe("a");
    expect(result.current[1]!.onToggle).toBe(b!.onToggle);
  });
});
