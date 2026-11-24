import { z } from "zod";
import { AUTO_CLEAN } from "@/config/policy";
import type { CleanBasis, CleanRule } from "@/domain/auto-clean";

export const CLEAN_BASES = ["created", "modified"] as const satisfies readonly CleanBasis[];

/** A folder's auto-clean rule as saved (PUT /api/nodes/<id>/auto-clean). */
export const autoCleanRuleSchema = z.object({
  olderThanDays: z.number().int().min(1).max(AUTO_CLEAN.maxDays),
  basis: z.enum(CLEAN_BASES),
});

/** A rule to preview (GET ?days=&basis=); without both, the saved rule is counted. */
export const autoCleanPreviewQuerySchema = z.union([
  z.object({ days: z.coerce.number().int().min(1).max(AUTO_CLEAN.maxDays), basis: z.enum(CLEAN_BASES) }),
  z.object({}).strict(),
]);

/** The folder's rule (null: none) and how many files the previewed rule would move now. */
export interface AutoCleanView {
  rule: CleanRule | null;
  due: number;
}
