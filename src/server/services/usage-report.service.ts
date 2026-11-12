import "server-only";
import { ADMIN_REPORT } from "@/config/policy";
import type { UsageQuery, UsageReport, UsageRow } from "@/contracts/admin";
import { toCsv } from "@/domain/csv";
import { fillMonths, reportRange, sortUsage, USAGE_CSV_HEADER, usageCsvName, usageCsvRows } from "@/domain/usage-report";
import { db } from "../db/client";
import { ApiError } from "../http/api-error";
import { apiTokenCountsByAccount, listAccountsForAdmin, nodeTotalsByAccount, trafficByMonth, trafficTotalsByAccount, trashTotalsByAccount } from "../repositories/admin.repo";

const dateOf = (day: string) => new Date(`${day}T00:00:00Z`);

/**
 * Storage, trash and share traffic per account for the days of `query`, largest storage first,
 * and the traffic of all accounts per month. Built from counters only: no file names, links or
 * addresses (docs/security.md "관리자"). A range out of bounds is a 400 with the reason.
 */
export async function usageReport(query: UsageQuery, now: Date = new Date()): Promise<UsageReport> {
  const range = reportRange(query, now.getTime(), ADMIN_REPORT);
  if ("error" in range) throw new ApiError("BAD_REQUEST", range.error);
  const from = dateOf(range.from);
  const to = dateOf(range.to);
  const [accounts, nodes, trash, traffic, tokens, months] = await Promise.all([
    listAccountsForAdmin(db()),
    nodeTotalsByAccount(db()),
    trashTotalsByAccount(db()),
    trafficTotalsByAccount(db(), from, to),
    apiTokenCountsByAccount(db()),
    trafficByMonth(db(), from, to),
  ]);
  const rows: UsageRow[] = accounts.map((account) => {
    const node = nodes.get(account.id);
    return {
      id: account.id,
      name: account.name,
      isAdmin: account.isAdmin,
      usedBytes: (node?.bytes ?? 0n).toString(),
      quotaBytes: account.quotaBytes?.toString() ?? null,
      files: node?.files ?? 0,
      folders: node?.folders ?? 0,
      trashBytes: (trash.get(account.id) ?? 0n).toString(),
      trafficBytes: (traffic.get(account.id) ?? 0n).toString(),
      apiTokens: tokens.get(account.id) ?? 0,
      lastLoginAt: account.lastLoginAt.toISOString(),
    };
  });
  return { ...range, rows: sortUsage(rows, "used"), months: fillMonths(range, months) };
}

/** The report as a CSV file (formula-safe cells, domain/csv.ts). */
export async function usageReportCsv(query: UsageQuery, now: Date = new Date()): Promise<{ name: string; csv: string }> {
  const report = await usageReport(query, now);
  return { name: usageCsvName(report), csv: toCsv([USAGE_CSV_HEADER, ...usageCsvRows(report.rows)]) };
}
