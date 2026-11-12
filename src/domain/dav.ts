/**
 * WebDAV (RFC 4918) for the account's files: request paths, the Depth header and the
 * multistatus XML a PROPFIND answers with, and the headers of writes (Destination, Overwrite,
 * locks). Clients (Finder, Windows Explorer, rclone, davfs2) only need these properties.
 */
import { nameError } from "./names";

/** Folder names below the account root for a request path under `prefix`, or null when invalid. */
export function davSegments(pathname: string, prefix: string): string[] | null {
  if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) return null;
  const parts = pathname.slice(prefix.length).split("/").filter(Boolean);
  const segments: string[] = [];
  for (const part of parts) {
    let name: string;
    try {
      name = decodeURIComponent(part);
    } catch {
      return null;
    }
    if (nameError(name)) return null;
    segments.push(name);
  }
  return segments;
}

export type DavDepth = "0" | "1" | "infinity";

/** The Depth header of a PROPFIND; missing means infinity (RFC 4918 9.1). */
export function davDepth(header: string | null): DavDepth {
  const value = header?.trim().toLowerCase();
  return value === "0" || value === "1" ? value : "infinity";
}

/** One resource of a multistatus answer. */
export interface DavEntry {
  segments: string[];
  folder: boolean;
  name: string;
  size: bigint;
  mime: string | null;
  etag: string | null;
  createdAt: Date;
  modifiedAt: Date;
}

const escapeXml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

/** The href of a resource: each name percent-encoded, folders ending in "/". */
export function davHref(prefix: string, segments: readonly string[], folder: boolean): string {
  const path = segments.map(encodeURIComponent).join("/");
  return `${prefix}/${path}${folder && path ? "/" : ""}`;
}

function davResponse(prefix: string, entry: DavEntry): string {
  const props = [
    `<D:displayname>${escapeXml(entry.name)}</D:displayname>`,
    `<D:creationdate>${entry.createdAt.toISOString()}</D:creationdate>`,
    `<D:getlastmodified>${entry.modifiedAt.toUTCString()}</D:getlastmodified>`,
    entry.folder ? "<D:resourcetype><D:collection/></D:resourcetype>" : "<D:resourcetype/>",
    ...(entry.folder ? [] : [`<D:getcontentlength>${entry.size.toString()}</D:getcontentlength>`, `<D:getcontenttype>${escapeXml(entry.mime ?? "application/octet-stream")}</D:getcontenttype>`]),
    ...(entry.etag ? [`<D:getetag>"${escapeXml(entry.etag)}"</D:getetag>`] : []),
  ];
  return `<D:response><D:href>${escapeXml(davHref(prefix, entry.segments, entry.folder))}</D:href><D:propstat><D:prop>${props.join("")}</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`;
}

/** The 207 Multi-Status body for these resources (the requested one first). */
export function davMultistatus(prefix: string, entries: readonly DavEntry[]): string {
  return `<?xml version="1.0" encoding="utf-8"?>\n<D:multistatus xmlns:D="DAV:">${entries.map((entry) => davResponse(prefix, entry)).join("")}</D:multistatus>\n`;
}

/** True when `inner` is `outer` or below it. */
export function davWithin(outer: readonly string[], inner: readonly string[]): boolean {
  return outer.length <= inner.length && outer.every((name, index) => inner[index] === name);
}

/**
 * Names below the account root of a MOVE/COPY Destination (an absolute URL or a path), or null
 * when it is missing or outside `prefix`. Only the path counts: Nginx serves one site.
 */
export function davDestination(header: string | null, prefix: string): string[] | null {
  if (!header) return null;
  let pathname: string;
  try {
    pathname = new URL(header, "http://destination.invalid").pathname;
  } catch {
    return null;
  }
  return davSegments(pathname, prefix);
}

/** The Overwrite header: only "F" refuses to replace (RFC 4918 10.6). */
export function davOverwrite(header: string | null): boolean {
  return header?.trim().toUpperCase() !== "F";
}

/** Files macOS writes next to every file on a network drive (resource forks, folder view settings). */
export function isMacMetadata(name: string): boolean {
  return name.startsWith("._") || name === ".DS_Store";
}

/** Seconds a LOCK lasts: the first "Second-N" of the Timeout header, at most `max` ("Infinite" and missing mean `max`). */
export function davLockTimeout(header: string | null, max: number): number {
  for (const part of (header ?? "").split(",")) {
    const match = /^\s*second-(\d+)\s*$/i.exec(part);
    if (match) return Math.min(Math.max(Number(match[1]), 1), max);
  }
  return max;
}

/** The lock token a LOCK refresh or UNLOCK names (If or Lock-Token header), or null. */
export function davLockTokenOf(header: string | null): string | null {
  return /<(opaquelocktoken:[0-9a-f-]+)>/i.exec(header ?? "")?.[1] ?? null;
}

/** The body of a LOCK answer: an exclusive write lock on `href` with `token`. */
export function davLockDiscovery(href: string, token: string, timeoutSeconds: number, depth: "0" | "infinity"): string {
  return (
    '<?xml version="1.0" encoding="utf-8"?>\n<D:prop xmlns:D="DAV:"><D:lockdiscovery><D:activelock>' +
    "<D:locktype><D:write/></D:locktype><D:lockscope><D:exclusive/></D:lockscope>" +
    `<D:depth>${depth}</D:depth><D:timeout>Second-${timeoutSeconds}</D:timeout>` +
    `<D:locktoken><D:href>${escapeXml(token)}</D:href></D:locktoken><D:lockroot><D:href>${escapeXml(href)}</D:href></D:lockroot>` +
    "</D:activelock></D:lockdiscovery></D:prop>\n"
  );
}

/** A PROPPATCH answer: dead properties are not kept, but clients (Windows sets file times) expect success. */
export function davProppatchResult(href: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>\n<D:multistatus xmlns:D="DAV:"><D:response><D:href>${escapeXml(href)}</D:href><D:propstat><D:prop/><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response></D:multistatus>\n`;
}
