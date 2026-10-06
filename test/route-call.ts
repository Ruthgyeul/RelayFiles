import { NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/server/auth/session-cookie";

type Handler<P> = (req: NextRequest, ctx: { params: Promise<P> }) => Promise<Response>;

export interface CallOptions<P> {
  method?: string;
  body?: unknown;
  cookie?: string;
  ip?: string;
  query?: string;
  params?: P;
}

export interface CallResult<T> {
  status: number;
  json: { success: boolean; data: T; code?: string; error?: string; retryAfter?: number; fields?: Record<string, string> };
  /** Device cookie after the call (updated when the response set one). */
  cookie: string | undefined;
}

/** Calls a route handler directly, carrying the device cookie between calls. */
export async function callRoute<T, P = Record<string, never>>(handler: Handler<P>, options: CallOptions<P> = {}): Promise<CallResult<T>> {
  const headers = new Headers({ "content-type": "application/json", "user-agent": "Mozilla/5.0 (X11; Linux x86_64) Firefox/143.0" });
  if (options.cookie) headers.set("cookie", `${SESSION_COOKIE}=${options.cookie}`);
  if (options.ip) headers.set("x-real-ip", options.ip);
  const req = new NextRequest(`http://localhost/api/test${options.query ?? ""}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const res = await handler(req, { params: Promise.resolve((options.params ?? {}) as P) });
  const setCookie = res.headers.getSetCookie().find((line) => line.startsWith(`${SESSION_COOKIE}=`));
  const cookie = setCookie === undefined ? options.cookie : setCookie.split(";")[0]!.slice(SESSION_COOKIE.length + 1) || undefined;
  return { status: res.status, json: (await res.json()) as CallResult<T>["json"], cookie };
}
