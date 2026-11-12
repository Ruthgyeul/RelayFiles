import { clientInfo } from "@/server/auth/client-info";
import { requireRecentAuth } from "@/server/auth/device-session";
import { apiHandler } from "@/server/http/api-handler";
import { assertExportAllowed, exportAccount } from "@/server/services/account-export.service";
import { logAccountEvent } from "@/server/services/security-log.service";

/**
 * Checks that an export can start now (recent sign-in, not started in the last minutes)
 * before the browser navigates to the download; a REAUTH_REQUIRED here opens the dialog.
 */
export const POST = apiHandler({ auth: "active" }, async ({ active }) => {
  requireRecentAuth(active);
  await assertExportAllowed(active.account.id);
  return { ready: true };
});

/** The whole active account as one tar (files, folders and a manifest of their settings). */
export const GET = apiHandler<Response>({ auth: "active" }, async ({ req, active }) => {
  requireRecentAuth(active);
  const response = await exportAccount(active.account);
  await logAccountEvent(active.account.id, clientInfo(req.headers), "account.exported");
  return response;
});
