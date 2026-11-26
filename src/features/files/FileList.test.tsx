// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { NodeItem } from "@/contracts/nodes";
import type { ItemProps } from "./item-props";

const renders = vi.hoisted(() => ({ count: 0 }));
// itemMeta runs once per row render: counting its calls counts rendered rows.
vi.mock("./item-props", async (original) => {
  const actual = await original<typeof import("./item-props")>();
  return { ...actual, itemMeta: (...args: Parameters<typeof actual.itemMeta>) => (renders.count++, actual.itemMeta(...args)) };
});
const { FileList } = await import("./FileList");

const file = (id: string): NodeItem =>
  ({
    id,
    type: "file",
    name: `${id}.txt`,
    kind: "other",
    size: "1",
    itemCount: 0,
    fileCount: 1,
    tags: [],
    hasThumb: false,
    linkId: `link-${id}`,
    createdAt: "2026-01-01T00:00:00.000Z",
    modifiedAt: null,
    downloads: 0,
    busy: null,
    favorite: false,
    settings: { visibility: "inherit", expiry: "Never", expAt: null, burn: false, downloadLimit: null, hasPassword: false, access: "both", note: "", dlPaused: false, dailyCapGb: null },
  }) as unknown as NodeItem;

const items = ["a", "b", "c"].map(file);

function list(selected: ReadonlySet<string>, { view = "list", now = 0 }: { view?: "list" | "grid"; now?: number } = {}) {
  const itemProps = (item: NodeItem): ItemProps => ({
    item,
    parentVisibility: "private",
    selected: selected.has(item.id),
    now,
    // New closures every render, as the pages make them.
    onToggle: () => undefined,
    onPrimary: () => undefined,
    onPreview: () => undefined,
    onMenu: () => undefined,
    onTag: () => undefined,
    menuOpen: false,
    drag: { draggable: true, onDragStart: () => undefined, onDragEnd: () => undefined },
  });
  return <FileList items={items} view={view} itemProps={itemProps} emptyTitle="Empty" emptyActions={null} onOpen={() => undefined} onDownload={() => undefined} />;
}

describe("FileList", () => {
  it("renders only the rows whose item or state changed", () => {
    const view = render(list(new Set()));
    expect(renders.count).toBe(3);
    renders.count = 0;
    view.rerender(list(new Set(["b"])));
    expect(renders.count).toBe(1);
    renders.count = 0;
    view.rerender(list(new Set(["b"])));
    expect(renders.count).toBe(0);
  });

  it("keeps grid cards still when only the clock moves; rows show expiry from it", () => {
    const grid = render(list(new Set(), { view: "grid" }));
    expect(renders.count).toBe(3);
    renders.count = 0;
    grid.rerender(list(new Set(), { view: "grid", now: 30_000 }));
    expect(renders.count).toBe(0);
    grid.unmount();
    const rows = render(list(new Set()));
    renders.count = 0;
    rows.rerender(list(new Set(), { now: 30_000 }));
    expect(renders.count).toBe(3);
  });
});
