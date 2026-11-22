import { SELECTION_TOOLBAR, toolbarButtons } from "./item-actions";
import { ToolButton } from "./Toolbar";

export interface ToolbarHandlers {
  upload: () => void;
  uploadFolder: () => void;
  newFolder: () => void;
  /** What the selection buttons do with the selected items ("Rename" renames several at once). */
  selection: Record<(typeof SELECTION_TOOLBAR)[number], () => void>;
}

const selectionButtons = toolbarButtons(SELECTION_TOOLBAR);

/**
 * The File Manager's button groups (design toolbar): folder actions, the selection actions
 * that replace them, and the actions under an empty folder.
 */
export function toolbarActions(on: ToolbarHandlers) {
  const newFolderButton = <ToolButton icon="folder-plus" label="New folder" onClick={on.newFolder} />;
  return {
    folder: (
      <>
        <ToolButton variant="primary" icon="upload-simple" label="Upload" onClick={on.upload} />
        <ToolButton icon="folder-simple-plus" label="Upload folder" title="Upload a folder" onClick={on.uploadFolder} />
        {newFolderButton}
      </>
    ),
    empty: (
      <>
        <ToolButton variant="primary" icon="upload-simple" label="Upload files" onClick={on.upload} />
        {newFolderButton}
      </>
    ),
    selection: (
      <>
        {selectionButtons.map((button) => (
          <ToolButton key={button.id} icon={button.icon} label={button.label} title={button.title} danger={button.danger} onClick={on.selection[button.id]} />
        ))}
      </>
    ),
  };
}
