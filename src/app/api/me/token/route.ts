import { tokenQuerySchema } from "@/contracts/auth";
import { deviceOf } from "@/server/auth/current";
import { requireActive } from "@/server/auth/device-session";
import { ApiError } from "@/server/http/api-error";
import { apiHandler, ok } from "@/server/http/api-handler";
import { regenerateToken, revealToken } from "@/server/services/auth.service";

/**
 * Full token of an account signed in on this device (default: the active one), for
 * "Save token", "Copy token" in the account menu and the profile's "Show" button.
 */
export const GET = apiHandler(async ({ req }) => {
  const { accountId } = tokenQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
  const device = await deviceOf(req);
  const target = accountId ? device.accounts.find((item) => item.account.id === accountId) : requireActive(device);
  if (!target) throw new ApiError("NOT_FOUND");
  return ok({ token: await revealToken(target.account.id) }, { headers: { "cache-control": "no-store" } });
});

/** "Generate a new token": the old one stops working and other devices are signed out. */
export const POST = apiHandler(async ({ req }) => {
  const { account, sessionId } = requireActive(await deviceOf(req));
  const token = await regenerateToken(account.id, sessionId);
  return ok({ token, account: { id: account.id, name: account.name } }, { headers: { "cache-control": "no-store" } });
});
