"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import type { NodeItem } from "@/contracts/nodes";
import { formatSize } from "@/domain/format";
import { nameError, splitExtension } from "@/domain/names";
import { useShell } from "@/features/shell/ShellProvider";
import { ApiClientError } from "@/shared/lib/api-client";
import { ConfirmDialog } from "@/shared/ui/ConfirmDialog";
import { PromptDialog } from "@/shared/ui/PromptDialog";
import { ActivityDialog, type ActivityRequest } from "./ActivityDialog";
import { filesApi } from "./api";
import { kindOf } from "./kind";
import { MoveDialog, type MoveRequest } from "./MoveDialog";
import { SettingsDialog, type SettingsRequest } from "./SettingsDialog";
import { TagsDialog, type TagsRequest } from "./TagsDialog";

interface Context {
  isAdmin: boolean;
  accountDeletesAt: string | null;
  linkOf: (linkId: string) => string;
  /** Called after any change so the page reloads its data and clears the selection. */
  onChanged: () => void;
}

const errorText = (caught: unknown) => (caught instanceof ApiClientError ? caught.message : "Something went wrong.");
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
const labelOf = (items: NodeItem[]) => (items.length === 1 ? `"${items[0]!.name}"` : `${items.length} items`);

/** Delete confirmation text from the design (`delTitle`, `delText`). */
export function deleteText(items: NodeItem[]): { title: string; text: string } {
  const one = items.length === 1 ? items[0]! : null;
  const size = items.reduce((sum, item) => sum + Number(item.size), 0);
  const files = items.reduce((sum, item) => sum + item.fileCount, 0);
  const what = one && one.type === "file" ? formatSize(size) : `${plural(files, "file")} · ${formatSize(size)}`;
  return {
    title: one ? `Delete "${one.name}"?` : `Delete ${items.length} items?`,
    text: `${what} will be permanently deleted. Share links to ${one ? "it" : "them"} stop working. This can't be undone.`,
  };
}

/**
 * State and dialogs for file operations: rename, move/copy, delete, tags, share settings,
 * new link, activity and the admin download pause. Returns the openers and the dialogs.
 */
export function useFileDialogs({ isAdmin, accountDeletesAt, linkOf, onChanged }: Context) {
  const router = useRouter();
  const { notify } = useShell();
  const [rename, setRename] = useState<{ item: NodeItem; error?: string } | null>(null);
  const [move, setMove] = useState<MoveRequest | null>(null);
  const [remove, setRemove] = useState<NodeItem[] | null>(null);
  const [tags, setTags] = useState<TagsRequest | null>(null);
  const [settings, setSettings] = useState<SettingsRequest | null>(null);
  const [activity, setActivity] = useState<ActivityRequest | null>(null);
  const [relink, setRelink] = useState<NodeItem | null>(null);
  const [busy, setBusy] = useState(false);

  const changed = (message?: string) => {
    if (message) notify(message);
    onChanged();
    router.refresh();
  };

  const open = {
    rename: (item: NodeItem) => setRename({ item }),
    move: (items: NodeItem[], mode: "move" | "copy", parentId: string) => setMove({ ids: items.map((item) => item.id), mode, label: labelOf(items), parentIds: [parentId] }),
    remove: (items: NodeItem[]) => setRemove(items),
    tags: (items: NodeItem[]) =>
      setTags({
        ids: items.map((item) => item.id),
        name: items.length === 1 ? items[0]!.name : `${items.length} items`,
        tags: items.map((item) => item.tags).reduce((shared, list) => shared.filter((tag) => list.includes(tag))),
      }),
    settings: (item: NodeItem, isRoot: boolean, parentVisibility: "private" | "public") => setSettings({ item, isRoot, parentVisibility }),
    activity: (item: NodeItem) => setActivity({ id: item.id, name: item.name, url: linkOf(item.linkId) }),
    newLink: (item: NodeItem) => setRelink(item),
    togglePause: async (item: NodeItem) => {
      try {
        await filesApi.setPaused(item.id, !item.settings.dlPaused);
        changed(item.settings.dlPaused ? "Downloads resumed" : "Downloads paused");
      } catch (caught) {
        notify(errorText(caught));
      }
    },
  };

  const run = async (action: () => Promise<void>, close: () => void) => {
    setBusy(true);
    try {
      await action();
      close();
    } catch (caught) {
      notify(errorText(caught));
    } finally {
      setBusy(false);
    }
  };

  const removal = remove ? deleteText(remove) : null;
  const dialogs: ReactNode = (
    <>
      {rename && (
        <PromptDialog
          key={rename.item.id}
          open
          title={rename.item.type === "folder" ? "Rename folder" : "Rename file"}
          icon={kindOf(rename.item).icon}
          iconColor={kindOf(rename.item).color}
          iconWeight={rename.item.type === "folder" ? "fill" : "regular"}
          initialValue={rename.item.name}
          confirmLabel="Rename"
          validate={(value) => (value ? nameError(value) : "")}
          selectOnFocus={(value) => [0, splitExtension(value, rename.item.type === "file")[0].length]}
          error={rename.error}
          onCancel={() => setRename(null)}
          onSubmit={(value) => {
            if (value === rename.item.name) return setRename(null);
            filesApi
              .rename(rename.item.id, value)
              .then(() => {
                setRename(null);
                changed("Renamed");
              })
              .catch((caught: unknown) => setRename({ item: rename.item, error: errorText(caught) }));
          }}
        />
      )}
      <MoveDialog request={move} onClose={() => setMove(null)} onDone={(message) => changed(message)} />
      <ConfirmDialog
        open={remove !== null}
        tone="danger"
        icon="trash"
        title={removal?.title ?? ""}
        description={removal?.text}
        confirmLabel="Delete"
        busy={busy}
        onCancel={() => setRemove(null)}
        onConfirm={() =>
          void run(async () => {
            const { deleted } = await filesApi.remove(remove!.map((item) => item.id));
            changed(deleted === 1 ? "Deleted" : `${deleted} items deleted`);
          }, () => setRemove(null))
        }
      />
      <TagsDialog
        request={tags}
        onClose={() => {
          setTags(null);
          changed();
        }}
      />
      {settings && (
        <SettingsDialog
          key={settings.item.id}
          request={settings}
          isAdmin={isAdmin}
          accountDeletesAt={accountDeletesAt}
          onClose={() => setSettings(null)}
          onSaved={(message) => {
            setSettings(null);
            changed(message);
          }}
        />
      )}
      <ActivityDialog request={activity} onClose={() => setActivity(null)} />
      <ConfirmDialog
        open={relink !== null}
        tone="accent"
        icon="arrows-clockwise"
        title={`Create a new link for "${relink?.name ?? ""}"?`}
        description="The current link stops working immediately."
        confirmLabel="New link"
        busy={busy}
        onCancel={() => setRelink(null)}
        onConfirm={() =>
          void run(async () => {
            await filesApi.newLink(relink!.id);
            changed("New link created · old link disabled");
          }, () => setRelink(null))
        }
      />
    </>
  );

  return { open, dialogs };
}
