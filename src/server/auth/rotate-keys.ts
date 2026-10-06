import "server-only";
import { MIGRATION } from "@/config/policy";
import type { DbClient } from "../db/client";
import { decryptToken, encryptToken, needsReencryption, tokenLookups, type TokenKeys } from "./token-crypto";

export interface RotationResult {
  checked: number;
  updated: number;
  /** Accounts whose token no configured key can decrypt (left unchanged). */
  unreadable: string[];
}

/**
 * Re-encrypts every account token with the current TOKEN_ENC_KEY and rehashes its lookup
 * with the current TOKEN_HMAC_KEY (docs/plan.md §13.8 ⑥). Tokens themselves never change.
 * Afterwards the *_PREVIOUS keys can be removed. Safe to run again: up-to-date rows are skipped.
 */
export async function rotateAccountKeys(db: DbClient, keys: TokenKeys, onBatch?: (done: number) => void): Promise<RotationResult> {
  let cursor: string | undefined;
  const result: RotationResult = { checked: 0, updated: 0, unreadable: [] };
  for (;;) {
    const rows = await db.account.findMany({
      orderBy: { id: "asc" },
      take: MIGRATION.batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, tokenLookup: true, tokenEnc: true },
    });
    if (rows.length === 0) return result;
    for (const row of rows) {
      result.checked += 1;
      let token: string;
      try {
        token = decryptToken(row.tokenEnc, keys);
      } catch {
        result.unreadable.push(row.id);
        continue;
      }
      const lookup = tokenLookups(token, keys)[0]!;
      if (row.tokenLookup !== lookup || needsReencryption(row.tokenEnc, keys)) {
        await db.account.update({ where: { id: row.id }, data: { tokenLookup: lookup, tokenEnc: new Uint8Array(encryptToken(token, keys)) } });
        result.updated += 1;
      }
    }
    cursor = rows.at(-1)!.id;
    onBatch?.(result.checked);
  }
}
