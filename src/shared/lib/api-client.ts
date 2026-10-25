import type { ApiResponse } from "@/contracts/api";
import { isErrorCode, type ErrorCode } from "@/contracts/errors";

/** A failed API call with the server's client-safe message and error code. */
export class ApiClientError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly status: number,
    readonly retryAfter?: number,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

const NETWORK_ERROR = "Can't reach the server. Check your connection and try again.";

/** Asks the user to enter their token again; true when they did (see {@link setReauthHandler}). */
export type ReauthHandler = () => Promise<boolean>;
let reauthHandler: ReauthHandler | null = null;

/**
 * Registers what happens when an admin action answers REAUTH_REQUIRED: the app shell opens
 * "Confirm it's you", and the call is sent once more after the token was entered.
 */
export function setReauthHandler(handler: ReauthHandler | null): void {
  reauthHandler = handler;
}

/**
 * Calls a RelayFiles API route and unwraps the `{ success, data }` envelope.
 * Throws ApiClientError for failures, including network errors and non-JSON responses
 * (e.g. an Nginx 502 page while the app restarts).
 */
export async function apiFetch<T>(url: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  try {
    return await request<T>(url, init);
  } catch (error) {
    if (!(error instanceof ApiClientError) || error.code !== "REAUTH_REQUIRED" || !reauthHandler || !(await reauthHandler())) throw error;
    return request<T>(url, init);
  }
}

async function request<T>(url: string, init: RequestInit & { json?: unknown }): Promise<T> {
  const { json, headers, ...rest } = init;
  let response: Response;
  try {
    response = await fetch(url, {
      credentials: "same-origin",
      ...rest,
      headers: json === undefined ? headers : { "content-type": "application/json", ...headers },
      body: json === undefined ? rest.body : JSON.stringify(json),
    });
  } catch {
    throw new ApiClientError("INTERNAL", NETWORK_ERROR, 0);
  }
  const body = (await response.json().catch(() => null)) as ApiResponse<T> | null;
  if (body?.success) return body.data;
  if (body && !body.success && isErrorCode(body.code)) {
    throw new ApiClientError(body.code, body.error, response.status, body.retryAfter, body.fields);
  }
  throw new ApiClientError(response.status === 503 ? "MAINTENANCE" : "INTERNAL", NETWORK_ERROR, response.status);
}
