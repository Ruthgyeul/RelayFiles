import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** Where `relayfiles login` keeps the server and token (only the user may read it). */
export interface CliConfig {
  server: string;
  token: string;
}

const FILE_MODE = 0o600;
const DIR_MODE = 0o700;

/** $RELAYFILES_CONFIG, else $XDG_CONFIG_HOME/relayfiles/config.json, else ~/.config/relayfiles/config.json. */
export function configPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.RELAYFILES_CONFIG) return env.RELAYFILES_CONFIG;
  return join(env.XDG_CONFIG_HOME || join(homedir(), ".config"), "relayfiles", "config.json");
}

/** "https://files.example/" → "https://files.example"; only http(s) URLs are accepted. */
export function normalizeServer(raw: string): string {
  const url = new URL(raw.trim());
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("The server must be an http(s) URL.");
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

export async function saveConfig(config: CliConfig, path = configPath()): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: DIR_MODE });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, { mode: FILE_MODE });
  // An existing file keeps its old mode on write.
  await chmod(path, FILE_MODE);
}

/** The saved login, overridden by RELAYFILES_SERVER and RELAYFILES_TOKEN (scripts, CI). */
export async function loadConfig(env: NodeJS.ProcessEnv = process.env, path = configPath(env)): Promise<CliConfig> {
  let saved: Partial<CliConfig> = {};
  try {
    saved = JSON.parse(await readFile(path, "utf8")) as Partial<CliConfig>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error(`Can't read ${path}.`);
  }
  const server = env.RELAYFILES_SERVER || saved.server;
  const token = env.RELAYFILES_TOKEN || saved.token;
  if (!server || !token) throw new Error("Not signed in. Run: relayfiles login --server https://your.server");
  return { server: normalizeServer(server), token };
}
