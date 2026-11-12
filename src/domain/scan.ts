/**
 * Virus scans with clamd (ClamAV) over its INSTREAM protocol: the reply parser and what visitors
 * get for a file in each scan state (docs/security.md "업로드 링크 검사").
 */

export type ScanVerdict = { state: "clean" } | { state: "infected"; signature: string } | { state: "error"; message: string };

const FOUND = /^(?:stream|[^:]*): (.+) FOUND$/;
const OK = /^(?:stream|[^:]*): OK$/;
const ERROR = /^(.*) ERROR$/;

/** clamd's reply to zINSTREAM ("stream: OK", "stream: Eicar-Signature FOUND", "INSTREAM size limit exceeded. ERROR"). */
export function parseClamdReply(raw: string): ScanVerdict {
  const reply = raw.replace(/\0+$/, "").trim();
  if (OK.test(reply)) return { state: "clean" };
  const found = FOUND.exec(reply);
  if (found) return { state: "infected", signature: found[1]!.trim() };
  const error = ERROR.exec(reply);
  return { state: "error", message: (error ? error[1]! : reply || "no reply").trim() };
}

/** Errors that mean the file itself cannot be scanned (retrying will not help). */
export function permanentScanError(message: string): boolean {
  return /size limit exceeded/i.test(message);
}

export type ScanStateName = "NONE" | "PENDING" | "CLEAN" | "FAILED";

/** What keeps a visitor from a file in this scan state: still scanning, could not be scanned, or nothing. */
export function scanBlock(state: ScanStateName): "scanning" | "blocked" | null {
  if (state === "PENDING") return "scanning";
  if (state === "FAILED") return "blocked";
  return null;
}
