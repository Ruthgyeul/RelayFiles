import type { NodeItem, NodeSettingsDto } from "@/contracts/nodes";
import type { ShareSettings, SortableNode } from "@/domain/tree";

/** API settings → the shape the domain tag rules use. */
export function toShareSettings(settings: NodeSettingsDto): ShareSettings {
  return {
    visibility: settings.visibility,
    expiry: settings.expiry,
    expAt: settings.expAt ? Date.parse(settings.expAt) : null,
    burn: settings.burn,
    downloadLimit: settings.downloadLimit,
    hasPassword: settings.hasPassword,
    access: settings.access,
  };
}

/** API item → the shape the domain sort rules use. */
export function toSortable(item: NodeItem): SortableNode & { item: NodeItem } {
  return { type: item.type, name: item.name, kind: item.kind, size: Number(item.size), createdAt: Date.parse(item.createdAt), item };
}
