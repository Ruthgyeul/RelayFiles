import { ToolButton } from "./Toolbar";

export interface ToolbarHandlers {
  upload: () => void;
  uploadFolder: () => void;
  newFolder: () => void;
  download: () => void;
  zip: () => void;
  tags: () => void;
  copy: () => void;
  move: () => void;
  remove: () => void;
}

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
        <ToolButton icon="download-simple" label="Download" onClick={on.download} />
        <ToolButton icon="file-zip" label="Zip" title="Download as zip" onClick={on.zip} />
        <ToolButton icon="tag" label="Tags" onClick={on.tags} />
        <ToolButton icon="copy" label="Copy" onClick={on.copy} />
        <ToolButton icon="arrow-bend-up-right" label="Move" onClick={on.move} />
        <ToolButton icon="trash" label="Delete" danger onClick={on.remove} />
      </>
    ),
  };
}
