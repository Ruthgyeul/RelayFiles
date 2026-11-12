import type { CliConfig } from "./config.ts";

/** An error answer of the server ({ success: false, error, code }) or of the network. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(message: string, status: number, code: string | null) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const USER_AGENT = "relayfiles-cli";

/** Calls API v1 of one server with a personal API token (Bearer). */
export class Client {
  readonly server: string;
  readonly #token: string;

  constructor(config: CliConfig) {
    this.server = config.server;
    this.#token = config.token;
  }

  url(path: string): string {
    return new URL(path, `${this.server}/`).toString();
  }

  headers(extra: Record<string, string> = {}): Record<string, string> {
    return { authorization: `Bearer ${this.#token}`, "user-agent": USER_AGENT, ...extra };
  }

  /** A raw request (downloads, tus); the caller reads the body. */
  raw(method: string, path: string, init: { headers?: Record<string, string>; body?: string | Uint8Array } = {}): Promise<Response> {
    return fetch(this.url(path), { method, body: init.body, headers: this.headers(init.headers) });
  }

  /** A JSON request; answers the `data` of a success, throws {@link ApiError} otherwise. */
  async json<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.raw(method, path, body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return readJson<T>(res);
  }
}

/** The `data` of a `{ success: true, data }` answer, or an {@link ApiError}. */
export async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  type Answer = { success?: boolean; data?: T; error?: string; code?: string };
  let parsed: Answer | null = null;
  try {
    parsed = JSON.parse(text) as Answer;
  } catch {
    // Not JSON: a proxy page or a plain-text tus answer.
  }
  if (res.ok && parsed?.success) return parsed.data as T;
  throw new ApiError(parsed?.error ?? (text.trim().slice(0, 200) || `HTTP ${res.status}`), res.status, parsed?.code ?? null);
}
