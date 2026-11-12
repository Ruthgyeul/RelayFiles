import { z } from "zod";
import { ID_PATTERN } from "@/domain/ids";
import { clientInfo } from "@/server/auth/client-info";
import { ApiError } from "@/server/http/api-error";
import { apiHandler } from "@/server/http/api-handler";
import { signOutDevice } from "@/server/services/profile.service";
import { logAccountEvent } from "@/server/services/security-log.service";

/** Signs another device out of the active account (this device uses the sign-out button). */
export const DELETE = apiHandler<{ signedOut: true }, { id: string }>({ auth: "active" }, async ({ req, params, active: { account, sessionId } }) => {
  const id = z.string().regex(ID_PATTERN.session).parse(params.id);
  if (id === sessionId) throw new ApiError("BAD_REQUEST", "Use Sign out for this device.");
  const device = await signOutDevice(account.id, id);
  await logAccountEvent(account.id, clientInfo(req.headers), "device.signout", `${device.os} · ${device.browser}`);
  return { signedOut: true };
});
