/**
 * The share page (/share-target) after the share sheet posted files (docs/architecture.md
 * "설치 앱과 공유 대상"): the service worker sends it `?share=<id>` to collect them, or
 * `?error=…` when it could not read them. The server sends `?error=unavailable` when no service
 * worker took the post (not installed yet, or plain http).
 */

export type ShareProblem = "unavailable" | "unreadable" | "missing";

export type ShareTargetState = { kind: "claim"; id: string } | { kind: "problem"; problem: ShareProblem };

/** crypto.randomUUID() in the service worker. */
const SHARE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KNOWN: readonly ShareProblem[] = ["unavailable", "unreadable"];

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** What the page should do for its query string. Anything unexpected reads as "nothing was shared". */
export function shareTargetState(params: { share?: string | string[]; error?: string | string[] }): ShareTargetState {
  const share = first(params.share);
  if (share !== undefined && SHARE_ID.test(share)) return { kind: "claim", id: share };
  const error = first(params.error);
  const known = KNOWN.find((problem) => problem === error);
  return { kind: "problem", problem: known ?? "missing" };
}

/** Sentences for each problem, in the UI's English. */
export const SHARE_PROBLEM_TEXT: Record<ShareProblem, { title: string; body: string }> = {
  unavailable: { title: "Sharing isn't ready yet", body: "Open RelayFiles once from its home screen icon, then share the files again." },
  unreadable: { title: "Couldn't read the shared files", body: "Share them again, or upload them from Home." },
  missing: { title: "Nothing to upload", body: "The shared files are no longer here. Share them again, or upload them from Home." },
};

/** "3 files · 12.4 MB" style summary inputs: how many and how many bytes. */
export function sharedTotals(files: readonly { size: number }[]): { count: number; bytes: number } {
  return { count: files.length, bytes: files.reduce((sum, file) => sum + file.size, 0) };
}
