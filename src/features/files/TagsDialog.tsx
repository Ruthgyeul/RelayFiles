"use client";

import { useEffect, useState, type KeyboardEvent } from "react";
import { normalizeTag } from "@/domain/tags";
import { ApiClientError } from "@/shared/lib/api-client";
import { Button } from "@/shared/ui/Button";
import { Icon } from "@/shared/ui/icon/Icon";
import { Modal, ModalHeader } from "@/shared/ui/Modal";
import { filesApi } from "./api";

export interface TagsRequest {
  ids: string[];
  /** Item name, or "N items" when editing several. */
  name: string;
  /** Current tags (for several items: the tags they all share). */
  tags: string[];
}

/** Starter suggestions shown before the account has its own tags (design). */
const STARTER_TAGS = ["movie", "music", "photos", "work", "family", "archive"];
const MAX_SUGGESTIONS = 8;

/** Tag editor (440px). Changes are saved as they are made; several items are edited together. */
export function TagsDialog({ request, onClose }: { request: TagsRequest | null; onClose: () => void }) {
  const [tags, setTags] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [used, setUsed] = useState<{ tag: string; count: number }[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!request) return;
    let cancelled = false;
    queueMicrotask(() => !cancelled && setTags(request.tags));
    filesApi
      .tagUsage()
      .then((usage) => !cancelled && setUsed(usage))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [request]);

  const save = async (add: string[], remove: string[], next: string[]) => {
    if (!request) return;
    const previous = tags;
    setTags(next);
    setError("");
    try {
      await filesApi.tags(request.ids, add, remove);
    } catch (caught) {
      setTags(previous);
      setError(caught instanceof ApiClientError ? caught.message : "Something went wrong.");
    }
  };
  const add = (raw: string) => {
    const tag = normalizeTag(raw);
    setInput("");
    if (!tag || tags.includes(tag)) return;
    void save([tag], [], [...tags, tag]);
  };
  const remove = (tag: string) => void save([], [tag], tags.filter((existing) => existing !== tag));
  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      add(input);
    } else if (event.key === "Backspace" && !input && tags.length) {
      remove(tags.at(-1)!);
    }
  };

  const usedTags = used.map((entry) => entry.tag).filter((tag) => !tags.includes(tag));
  const starters = STARTER_TAGS.filter((tag) => !tags.includes(tag) && !used.some((entry) => entry.tag === tag));
  const suggestions = [...usedTags, ...starters].slice(0, MAX_SUGGESTIONS);
  const multi = request !== null && request.ids.length > 1;

  return (
    <Modal open={request !== null} onClose={onClose} width={440} layer="subdialog" className="overflow-hidden">
      <ModalHeader title={`Tags · ${request?.name ?? ""}`} icon="tag" onClose={onClose} closeSize={36} />
      <div className="flex flex-col gap-3.5 px-5 pt-[18px] pb-5">
        <div className="box-border flex min-h-11 flex-wrap items-center gap-1.5 rounded-xl border border-ctrl bg-bg px-2 py-1.5">
          {tags.map((tag) => (
            <span key={tag} className="flex h-7 items-center gap-1 rounded-full bg-accent-soft pr-1 pl-2.5 text-[13px] font-bold text-accent-text">
              <Icon name="hash" />
              {tag}
              <button type="button" title="Remove" aria-label={`Remove ${tag}`} onClick={() => remove(tag)} className="flex size-[22px] items-center justify-center rounded-[11px] border-0 bg-transparent text-accent-text">
                <Icon name="x" size={12} />
              </button>
            </span>
          ))}
          <input
            autoFocus
            aria-label="Add a tag"
            value={input}
            onChange={(event) => setInput(event.target.value.toLowerCase())}
            onKeyDown={onKey}
            placeholder="Add a tag and press Enter"
            className="h-[30px] min-w-[140px] flex-1 border-0 bg-transparent text-[14px] text-t1 outline-none placeholder:text-t5"
          />
        </div>
        {suggestions.length > 0 && (
          <div className="flex flex-col gap-2">
            <span className="text-[12px] font-bold text-t4">Suggestions</span>
            <div className="flex flex-wrap gap-1.5">
              {suggestions.map((tag) => (
                <button key={tag} type="button" onClick={() => add(tag)} className="flex h-[30px] items-center gap-1 rounded-full border border-ctrl bg-btn px-2.5 text-[12px] font-semibold text-t2">
                  <Icon name="plus" size={11} />
                  {tag}
                </button>
              ))}
            </div>
          </div>
        )}
        {multi && (
          <span className="text-[12px] text-pretty text-accent-text">
            Showing tags shared by all {request.ids.length} items. Adding or removing applies to every selected item.
          </span>
        )}
        {error && <span className="text-[13px] text-danger-text">{error}</span>}
        <span className="text-[12px] text-pretty text-t4">Tags are private to your account. Search #tag1 #tag2 (or click tags) to list only files that have every tag.</span>
        <div className="flex justify-end">
          <Button variant="primary" size={38} onClick={onClose} className="px-[18px]">
            Done
          </Button>
        </div>
      </div>
    </Modal>
  );
}
