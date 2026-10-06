// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
