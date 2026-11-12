#!/usr/bin/env node
import { parseArgs } from "node:util";
import type { SharePatch } from "./api-types.ts";
import { ApiError, Client } from "./client.ts";
import { download, favorite, login, ls, share, shares, upload, versions, whoami } from "./commands.ts";
import { loadConfig } from "./config.ts";

const USAGE = `relayfiles: command-line client for a RelayFiles server (API v1)

  relayfiles login [--server URL] [--token rfp_…]   save the server and a personal API token
  relayfiles whoami                                 the token's account and storage use
  relayfiles ls [folderId]                          list a folder (root by default)
  relayfiles download <fileId> [-o path]            download a file (continues a .part file)
  relayfiles upload <file…> [--folder id] [--replace] [--chunk-mb 50]
  relayfiles share <id> [--public|--private|--inherit] [--password pw|--no-password] [--limit n|--no-limit] [--note text]
  relayfiles shares                                 everything shared from the account
  relayfiles versions <fileId>                      earlier versions of a file
  relayfiles favorite <id> [--remove]               add to (or take out of) Favorites

Environment: RELAYFILES_SERVER and RELAYFILES_TOKEN override the saved login;
RELAYFILES_CONFIG moves the config file (default ~/.config/relayfiles/config.json).`;

const OPTIONS = {
  server: { type: "string" },
  token: { type: "string" },
  output: { type: "string", short: "o" },
  folder: { type: "string", default: "root" },
  replace: { type: "boolean", default: false },
  "chunk-mb": { type: "string" },
  public: { type: "boolean" },
  private: { type: "boolean" },
  inherit: { type: "boolean" },
  password: { type: "string" },
  "no-password": { type: "boolean" },
  limit: { type: "string" },
  "no-limit": { type: "boolean" },
  note: { type: "string" },
  remove: { type: "boolean", default: false },
  help: { type: "boolean", short: "h" },
} as const;

type Values = ReturnType<typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true }>>["values"];

/** The share settings the options ask for, or null when none were given. */
export function sharePatchOf(values: Values): SharePatch | null {
  const patch: SharePatch = {};
  const visibility = values.public ? "public" : values.private ? "private" : values.inherit ? "inherit" : undefined;
  if (visibility) patch.visibility = visibility;
  if (values.password !== undefined) patch.password = values.password;
  if (values["no-password"]) patch.password = null;
  if (values.limit !== undefined) {
    const limit = Number(values.limit);
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("--limit must be a whole number above 0.");
    patch.downloadLimit = limit;
  }
  if (values["no-limit"]) patch.downloadLimit = null;
  if (values.note !== undefined) patch.note = values.note;
  return Object.keys(patch).length > 0 ? patch : null;
}

function need(value: string | undefined, what: string): string {
  if (!value) throw new Error(`Missing ${what}.\n\n${USAGE}`);
  return value;
}

async function run(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
  const [command, ...rest] = positionals;
  if (!command || values.help) return void process.stdout.write(`${USAGE}\n`);
  if (command === "login") return login(values.server, values.token);
  const client = new Client(await loadConfig());
  switch (command) {
    case "whoami":
      return whoami(client);
    case "ls":
      return ls(client, rest[0]);
    case "download":
      return download(client, need(rest[0], "a file id"), values.output);
    case "upload": {
      if (rest.length === 0) need(undefined, "a file to upload");
      const chunkMb = values["chunk-mb"] === undefined ? undefined : Number(values["chunk-mb"]);
      if (chunkMb !== undefined && !(chunkMb > 0)) throw new Error("--chunk-mb must be above 0.");
      return upload(client, rest, values.folder, values.replace, chunkMb);
    }
    case "share":
      return share(client, need(rest[0], "an item id"), sharePatchOf(values));
    case "shares":
      return shares(client);
    case "versions":
      return versions(client, need(rest[0], "a file id"));
    case "favorite":
      return favorite(client, need(rest[0], "an item id"), !values.remove);
    default:
      throw new Error(`Unknown command "${command}".\n\n${USAGE}`);
  }
}

// Imported by tests for sharePatchOf: only run as the program.
if (import.meta.main) {
  run(process.argv.slice(2)).catch((error: unknown) => {
    const message = error instanceof ApiError ? `${error.message} (${error.status}${error.code ? ` ${error.code}` : ""})` : error instanceof Error ? error.message : String(error);
    process.stderr.write(`relayfiles: ${message}\n`);
    process.exitCode = 1;
  });
}
