"use client";

import { useState } from "react";
import { BottomSheet } from "@/shared/ui/BottomSheet";
import { Button } from "@/shared/ui/Button";
import { ConfirmDialog } from "@/shared/ui/ConfirmDialog";
import { Menu, MenuItem, MenuLabel, MenuSeparator } from "@/shared/ui/Menu";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/shared/ui/Modal";
import { PromptDialog } from "@/shared/ui/PromptDialog";
import { Row, Section } from "./Section";

type Overlay = "modal" | "confirm" | "prompt" | "sheet" | null;

const noop = () => undefined;

export function OverlaysSection() {
  const [open, setOpen] = useState<Overlay>(null);
  const close = () => setOpen(null);

  return (
    <Section id="overlays" title="Menus and dialogs">
      <Row>
        <Menu label="File actions">
          <MenuItem icon="eye" onSelect={noop}>
            Preview
          </MenuItem>
          <MenuItem icon="download-simple" onSelect={noop}>
            Download
          </MenuItem>
          <MenuSeparator />
          <MenuItem icon="pencil-simple" onSelect={noop}>
            Rename
          </MenuItem>
          <MenuItem icon="trash" danger onSelect={noop}>
            Delete
          </MenuItem>
        </Menu>
        <Menu label="Sort">
          <MenuLabel>SORT BY</MenuLabel>
          <MenuItem icon="check" color="var(--accentText)" onSelect={noop}>
            Name A → Z
          </MenuItem>
          <MenuItem icon="check" onSelect={noop}>
            Newest first
          </MenuItem>
        </Menu>
        <Menu size="sm" label="Account">
          <MenuItem size="sm" icon="user" onSelect={noop}>
            Profile
          </MenuItem>
          <MenuItem size="sm" icon="sign-out" danger onSelect={noop}>
            Sign out
          </MenuItem>
        </Menu>
      </Row>
      <Row>
        <Button onClick={() => setOpen("modal")} data-testid="open-modal">
          Open modal
        </Button>
        <Button onClick={() => setOpen("confirm")}>Confirm dialog</Button>
        <Button onClick={() => setOpen("prompt")}>Prompt dialog</Button>
        <Button onClick={() => setOpen("sheet")}>Bottom sheet</Button>
      </Row>

      <Modal open={open === "modal"} onClose={close} width={480}>
        <ModalHeader title="Folder settings · Example" onClose={close} />
        <ModalBody>
          <p className="m-0 text-[13px] text-t4">Dialog body with 20px padding and 16px gaps.</p>
        </ModalBody>
        <ModalFooter>
          <Button size={36} className="px-4 text-[14px]" onClick={close}>
            Cancel
          </Button>
          <Button size={36} variant="primary" className="px-4 text-[14px]" onClick={close}>
            Save
          </Button>
        </ModalFooter>
      </Modal>

      <ConfirmDialog
        open={open === "confirm"}
        title='Delete "example.mp4"?'
        description="The file will be permanently deleted. Share links to it stop working. This can't be undone."
        confirmLabel="Delete"
        onConfirm={close}
        onCancel={close}
      />

      {open === "prompt" && (
        <PromptDialog
          open
          title="Rename file"
          icon="file-video"
          iconColor="var(--color-kind-video)"
          initialValue="example.mp4"
          confirmLabel="Rename"
          validate={(value) => (value.includes("/") ? 'Name can\'t contain "/".' : "")}
          selectOnFocus={(value) => [0, Math.max(0, value.lastIndexOf(".")) || value.length]}
          onSubmit={close}
          onCancel={close}
        />
      )}

      <BottomSheet open={open === "sheet"} onClose={close} label="File actions">
        <MenuItem icon="eye" onSelect={close}>
          Preview
        </MenuItem>
        <MenuItem icon="trash" danger onSelect={close}>
          Delete
        </MenuItem>
      </BottomSheet>
    </Section>
  );
}
