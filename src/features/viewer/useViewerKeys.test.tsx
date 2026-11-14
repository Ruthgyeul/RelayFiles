// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useViewerKeys, type ViewerKeyActions } from "./useViewerKeys";

afterEach(cleanup);

function Harness({ actions }: { actions: ViewerKeyActions }) {
  useViewerKeys(true, actions);
  return <input aria-label="search" />;
}

const actions = (): ViewerKeyActions => ({ step: vi.fn(), close: vi.fn(), small: false, notify: vi.fn(), slideshow: { available: false, toggle: vi.fn() } });

describe("useViewerKeys", () => {
  it("steps through files with N and P", () => {
    const keys = actions();
    render(<Harness actions={keys} />);
    fireEvent.keyDown(document, { key: "n" });
    fireEvent.keyDown(document, { key: "p" });
    expect(keys.step).toHaveBeenNthCalledWith(1, 1);
    expect(keys.step).toHaveBeenNthCalledWith(2, -1);
  });

  it("leaves letters typed into a field and shortcuts with modifiers alone", () => {
    const keys = actions();
    const { getByLabelText } = render(<Harness actions={keys} />);
    fireEvent.keyDown(getByLabelText("search"), { key: "n" });
    fireEvent.keyDown(document, { key: "n", ctrlKey: true });
    fireEvent.keyDown(document, { key: "ArrowRight", metaKey: true });
    expect(keys.step).not.toHaveBeenCalled();
  });
});
