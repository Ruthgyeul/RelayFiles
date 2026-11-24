// @vitest-environment jsdom
import { act, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useInView } from "./useInView";

type Callback = (entries: { isIntersecting: boolean }[]) => void;
const observers: { callback: Callback; disconnect: () => void }[] = [];

class FakeObserver {
  disconnect = vi.fn();
  constructor(callback: Callback) {
    observers.push({ callback, disconnect: this.disconnect });
  }
  observe() {}
}

function Probe({ onSeen }: { onSeen: (seen: boolean) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  onSeen(useInView(ref, 200));
  return <div ref={ref} />;
}

afterEach(() => {
  observers.length = 0;
  vi.unstubAllGlobals();
});

describe("useInView", () => {
  it("turns true when the element comes near the viewport, and stays true", () => {
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    const seen: boolean[] = [];
    render(<Probe onSeen={(value) => seen.push(value)} />);
    expect(seen.at(-1)).toBe(false);
    act(() => observers[0]!.callback([{ isIntersecting: false }]));
    expect(seen.at(-1)).toBe(false);
    act(() => observers[0]!.callback([{ isIntersecting: true }]));
    expect(seen.at(-1)).toBe(true);
    expect(observers[0]!.disconnect).toHaveBeenCalled();
  });

  it("is true without IntersectionObserver", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    const seen: boolean[] = [];
    render(<Probe onSeen={(value) => seen.push(value)} />);
    expect(seen.at(-1)).toBe(true);
  });
});
