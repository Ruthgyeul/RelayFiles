/**
 * Error codes shared by the API and the client. The client maps codes to screens and
 * dialogs (docs/plan.md §9); messages here are safe to show to users.
 */
export const ERRORS = {
  BAD_REQUEST: { status: 400, message: "The request is malformed." },
  UNAUTHORIZED: { status: 401, message: "Sign in required." },
  INVALID_TOKEN: { status: 401, message: "No account matches this token." },
  INVALID_INVITE: { status: 400, message: "Invalid or already used invite code." },
  SIGNUP_CLOSED: { status: 403, message: "New sign-ups are closed on this server." },
  FORBIDDEN: { status: 403, message: "Your account can't do that." },
  NOT_FOUND: { status: 404, message: "Not found." },
  CONFLICT: { status: 409, message: "That name already exists here." },
  ALREADY_SIGNED_IN: { status: 409, message: "This account is already signed in." },
  GONE: { status: 410, message: "This account or link no longer exists." },
  PAYLOAD_TOO_LARGE: { status: 413, message: "File too large." },
  UNSUPPORTED_MEDIA: { status: 415, message: "This photo can't be shared without its location data. Ask the owner for a JPEG or PNG." },
  RATE_LIMITED: { status: 429, message: "Too many requests. Try again later." },
  INTERNAL: { status: 500, message: "Something went wrong." },
  MAINTENANCE: { status: 503, message: "The server is under maintenance." },
  STORAGE_OFFLINE: { status: 503, message: "Storage is temporarily unavailable." },
  INSUFFICIENT_STORAGE: { status: 507, message: "Not enough space on the server." },
} as const satisfies Record<string, { status: number; message: string }>;

export type ErrorCode = keyof typeof ERRORS;

export const ERROR_CODES = Object.keys(ERRORS) as ErrorCode[];

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && Object.hasOwn(ERRORS, value);
}

/** Error codes that have a dedicated page under /error/[code]. */
export const ERROR_PAGE_CODES = ["400", "401", "403", "404", "410", "429", "500", "502", "503", "storage-offline"] as const;
export type ErrorPageCode = (typeof ERROR_PAGE_CODES)[number];
