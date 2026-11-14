// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BottomSheet } from "./BottomSheet";
import { Button } from "./Button";
import { ConfirmDialog } from "./ConfirmDialog";
import { Menu, MenuItem } from "./Menu";
import { Modal, ModalBody, ModalHeader } from "./Modal";
import { CheckRow, OptionChip } from "./Option";
import { PromptDialog } from "./PromptDialog";

afterEach(cleanup);

describe("Modal", () => {
  function Harness({ dismissible = true }: { dismissible?: boolean }) {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button onClick={() => setOpen(true)}>open</button>
        <Modal open={open} onClose={() => setOpen(false)} width={480} dismissible={dismissible}>
          <ModalHeader title="Settings" onClose={() => setOpen(false)} />
          <ModalBody>
            <input aria-label="first" />
          </ModalBody>
        </Modal>
      </>
    );
  }

  it("is labelled by its header, focuses inside, closes on Escape and restores focus", () => {
    render(<Harness />);
    const opener = screen.getByText("open");
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole("dialog", { name: "Settings" });
    expect(dialog.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("ignores Escape when not dismissible", () => {
    render(<Harness dismissible={false} />);
    fireEvent.click(screen.getByText("open"));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  // A typing field keeps focus while the parent re-renders with a new onClose, and the opener gets
  // focus back even though the field took focus with autoFocus before any effect ran.
  function TypingHarness() {
    const [open, setOpen] = useState(false);
    const [text, setText] = useState("");
    return (
      <>
        <button onClick={() => setOpen(true)}>open</button>
        <Modal open={open} onClose={() => setOpen(false)} width={480}>
          <ModalHeader title="Rename" onClose={() => setOpen(false)} />
          <ModalBody>
            <input aria-label="name" autoFocus value={text} onChange={(event) => setText(event.target.value)} />
          </ModalBody>
        </Modal>
      </>
    );
  }

  it("keeps focus in an autoFocus field while typing and returns it to the opener", () => {
    render(<TypingHarness />);
    const opener = screen.getByText("open");
    opener.focus();
    fireEvent.click(opener);
    const field = screen.getByLabelText("name");
    expect(document.activeElement).toBe(field);
    fireEvent.change(field, { target: { value: "a" } });
    fireEvent.change(field, { target: { value: "ab" } });
    expect(document.activeElement).toBe(field);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.activeElement).toBe(opener);
  });

  function StackedHarness() {
    const [outer, setOuter] = useState(true);
    const [inner, setInner] = useState(true);
    return (
      <>
        <Modal open={outer} onClose={() => setOuter(false)} width={480}>
          <ModalHeader title="Manage" onClose={() => setOuter(false)} />
        </Modal>
        <Modal open={inner} onClose={() => setInner(false)} width={360} layer="subdialog">
          <ModalHeader title="Confirm" onClose={() => setInner(false)} />
        </Modal>
      </>
    );
  }

  it("closes only the newest dialog on Escape", () => {
    render(<StackedHarness />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Confirm" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "Manage" })).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Manage" })).toBeNull();
  });
});

describe("BottomSheet", () => {
  function SheetHarness() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button onClick={() => setOpen(true)}>more</button>
        <BottomSheet open={open} onClose={() => setOpen(false)} label="Actions">
          <button role="menuitem">Rename</button>
          <button role="menuitem">Delete</button>
        </BottomSheet>
      </>
    );
  }

  it("moves focus in, keeps Tab inside, closes on Escape and gives focus back", () => {
    render(<SheetHarness />);
    const trigger = screen.getByText("more");
    trigger.focus();
    fireEvent.click(trigger);
    const [rename, remove] = screen.getAllByRole("menuitem");
    expect(document.activeElement).toBe(rename);
    remove!.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(rename);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});

describe("ConfirmDialog", () => {
  it("calls onConfirm and onCancel", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ConfirmDialog open title="Delete it?" confirmLabel="Delete" onConfirm={onConfirm} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onCancel).toHaveBeenCalledOnce();
  });
});

describe("PromptDialog", () => {
  it("shows validation errors and blocks submit until the value is valid", () => {
    const onSubmit = vi.fn();
    render(
      <PromptDialog
        open
        title="Rename"
        initialValue="a/b"
        confirmLabel="Rename"
        validate={(v) => (v.includes("/") ? "No slashes" : "")}
        onSubmit={onSubmit}
        onCancel={() => undefined}
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain("No slashes");
    expect((screen.getByRole("button", { name: "Rename" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "ok.txt" } });
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    expect(onSubmit).toHaveBeenCalledWith("ok.txt");
  });
});

describe("selection controls", () => {
  it("CheckRow exposes and toggles aria-checked", () => {
    const onChange = vi.fn();
    render(
      <CheckRow checked={false} onCheckedChange={onChange}>
        Burn after download
      </CheckRow>,
    );
    const box = screen.getByRole("checkbox", { name: "Burn after download" });
    expect(box.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(box);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("OptionChip reports its pressed state", () => {
    render(<OptionChip selected>Stream only</OptionChip>);
    expect(screen.getByRole("button", { name: "Stream only" }).getAttribute("aria-pressed")).toBe("true");
  });
});

describe("Menu", () => {
  it("moves focus between items with arrow keys", () => {
    render(
      <Menu label="Actions">
        <MenuItem icon="eye" onSelect={() => undefined}>
          Preview
        </MenuItem>
        <MenuItem icon="trash" danger onSelect={() => undefined}>
          Delete
        </MenuItem>
      </Menu>,
    );
    const [first, second] = screen.getAllByRole("menuitem");
    first!.focus();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowDown" });
    expect(document.activeElement).toBe(second);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowDown" });
    expect(document.activeElement).toBe(first);
  });
});

describe("Button", () => {
  it("defaults to type=button and can hide its label on mobile", () => {
    render(
      <Button icon="upload-simple" hideLabelOnMobile>
        Upload
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Upload" });
    expect(button.getAttribute("type")).toBe("button");
    expect(button.querySelector("span")?.className).toContain("max-sm:hidden");
  });
});
