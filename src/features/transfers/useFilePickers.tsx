"use client";

import { useCallback, useRef, type ReactNode } from "react";
import { entriesFromList, type UploadEntry } from "./read-drop";
import type { UploadTarget } from "./transfers-context";

/**
 * Hidden file and folder inputs behind the "Upload files" / "Upload folder" actions. The
 * picked files go to `onPicked` with the target the picker was opened for.
 */
export function useFilePickers(onPicked: (entries: UploadEntry[], target: UploadTarget) => void): {
  pickFiles: (target: UploadTarget) => void;
  pickFolder: (target: UploadTarget) => void;
  inputs: ReactNode;
} {
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const pickTarget = useRef<UploadTarget | null>(null);

  const picked = (list: FileList | null) => {
    const target = pickTarget.current;
    if (list && list.length && target) onPicked(entriesFromList(list), target);
  };
  // Stable, so the transfers context value only changes with its state.
  const pickFiles = useCallback((target: UploadTarget) => {
    pickTarget.current = target;
    fileInput.current?.click();
  }, []);
  const pickFolder = useCallback((target: UploadTarget) => {
    pickTarget.current = target;
    folderInput.current?.click();
  }, []);

  const inputs = (
    <>
      <input ref={fileInput} type="file" multiple hidden aria-hidden onChange={(event) => (picked(event.target.files), (event.target.value = ""))} />
      <input
        ref={(element) => {
          folderInput.current = element;
          // Folder pickers are not standard attributes in React's typings.
          element?.setAttribute("webkitdirectory", "");
          element?.setAttribute("directory", "");
        }}
        type="file"
        multiple
        hidden
        aria-hidden
        onChange={(event) => (picked(event.target.files), (event.target.value = ""))}
      />
    </>
  );
  return { pickFiles, pickFolder, inputs };
}
