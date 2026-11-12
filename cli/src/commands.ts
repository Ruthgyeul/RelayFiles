import { stat } from "node:fs/promises";
import { basename } from "node:path";
import { createInterface } from "node:readline/promises";
import type { Account, FileVersion, FolderView, NodeItem, PreparedUpload, Share, SharePatch, SharedView } from "./api-types.ts";
import { Client } from "./client.ts";
import { configPath, normalizeServer, saveConfig } from "./config.ts";
import { downloadFile } from "./download.ts";
import { formatSize, formatTime, table } from "./format.ts";
import { tusUpload } from "./tus.ts";

const MB = 1024 * 1024;
const DEFAULT_CHUNK_MB = 50;
const id = (value: string) => encodeURIComponent(value);
const out = (text: string) => process.stdout.write(`${text}\n`);

async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

/** `login --server URL [--token rfp_…]`: checks the token with /api/v1/me, then saves both (mode 0600). */
export async function login(server: string | undefined, token: string | undefined): Promise<void> {
  const url = normalizeServer(server ?? (await ask("Server URL: ")));
  const secret = token ?? process.env.RELAYFILES_TOKEN ?? (await ask("API token (rfp_…): "));
  const me = await new Client({ server: url, token: secret }).json<Account>("GET", "/api/v1/me");
  await saveConfig({ server: url, token: secret });
  out(`Signed in to ${url} as ${me.name} (${me.scopes.join(", ")}). Saved to ${configPath()}.`);
}

export async function whoami(client: Client): Promise<void> {
  const me = await client.json<Account>("GET", "/api/v1/me");
  out(`${me.name} on ${client.server} · ${formatSize(me.usedBytes)}${me.quotaBytes ? ` of ${formatSize(me.quotaBytes)}` : ""} · ${me.scopes.join(", ")}`);
}

const row = (item: NodeItem) => [item.type === "folder" ? "dir " : "file", item.type === "folder" ? `${item.itemCount} items` : formatSize(item.size), item.id, item.name];

/** `ls [folder]`: a folder's items (root by default). */
export async function ls(client: Client, folder = "root"): Promise<void> {
  const view = await client.json<FolderView>("GET", `/api/v1/folders/${id(folder)}`);
  out(
    `/${view.path
      .slice(1)
      .map((crumb) => crumb.name)
      .join("/")}`,
  );
  if (view.children.length > 0) out(table(view.children.map(row)));
}

export async function download(client: Client, fileId: string, output: string | undefined): Promise<void> {
  const name = await downloadFile(client, fileId, output ?? null, (file, total) => process.stderr.write(`Downloading ${file} (${formatSize(total)})…\n`));
  out(name);
}

/** `upload <file…> [--folder id] [--replace]`: one tus batch; a taken name is kept as both unless --replace. */
export async function upload(client: Client, paths: string[], folder: string, replace: boolean, chunkMb = DEFAULT_CHUNK_MB): Promise<void> {
  const files = await Promise.all(
    paths.map(async (path) => {
      const info = await stat(path);
      if (!info.isFile()) throw new Error(`${path} is not a file.`);
      return { path, size: info.size, name: basename(path), lastModified: info.mtimeMs };
    }),
  );
  const planned = await client.json<PreparedUpload>("POST", "/api/v1/uploads", { folder, files: files.map(({ name, size }) => ({ rel: name, size })), dup: replace ? "replace" : "keep" });
  if (planned.kind !== "ready") {
    out("Nothing to upload.");
    return;
  }
  for (const entry of planned.files) {
    const file = files[entry.index];
    if (!file) continue;
    let last = -1;
    await tusUpload(client, planned.endpoint, planned.batchId, entry.index, file, chunkMb * MB, (sent) => {
      const percent = file.size === 0 ? 100 : Math.floor((sent / file.size) * 100);
      if (percent !== last) process.stderr.write(`\r${file.name} ${percent}%`);
      last = percent;
    });
    process.stderr.write("\n");
    out(`${file.name} → ${planned.folder.name}`);
  }
}

const shareLine = (share: Share) =>
  `${share.url}  ${share.effectiveVisibility}${share.hasPassword ? " · password" : ""}${share.downloadLimit !== null ? ` · ${share.downloads}/${share.downloadLimit} downloads` : ""}`;

/** `share <id>`: shows the link; with options, changes the settings first. */
export async function share(client: Client, nodeId: string, patch: SharePatch | null): Promise<void> {
  const path = `/api/v1/nodes/${id(nodeId)}/share`;
  out(shareLine(patch ? await client.json<Share>("PATCH", path, patch) : await client.json<Share>("GET", path)));
}

/** `shares`: everything that can be opened from outside. */
export async function shares(client: Client): Promise<void> {
  const view = await client.json<SharedView>("GET", "/api/v1/shares");
  if (view.items.length === 0) {
    out("Nothing is shared.");
    return;
  }
  out(table(view.items.map((item) => [item.id, `${item.downloads} dl`, formatTime(item.lastActivityAt), `${item.parentPath}/${item.name}`])));
  if (view.truncated) out("(only the newest items are listed)");
}

export async function versions(client: Client, fileId: string): Promise<void> {
  const list = await client.json<FileVersion[]>("GET", `/api/v1/files/${id(fileId)}/versions`);
  if (list.length === 0) {
    out("No earlier versions.");
    return;
  }
  out(table(list.map((version) => [version.id, formatSize(version.size), `replaced ${formatTime(version.replacedAt)}`, `expires ${formatTime(version.expiresAt)}`])));
}

export async function favorite(client: Client, nodeId: string, on: boolean): Promise<void> {
  const item = await client.json<NodeItem>("PATCH", `/api/v1/nodes/${id(nodeId)}`, { favorite: on });
  out(on ? `${item.name} is in Favorites` : `${item.name} is out of Favorites`);
}
