import { z } from "zod";
import { ID_PATTERN } from "@/domain/ids";
import { deviceOf } from "@/server/auth/current";
import { requireAdmin } from "@/server/auth/device-session";
import { apiHandler } from "@/server/http/api-handler";
import { revokeInviteCode } from "@/server/services/server-settings.service";

/** Revokes an unused invite code. */
export const DELETE = apiHandler<{ revoked: true }, { code: string }>(async ({ req, params }) => {
  requireAdmin(await deviceOf(req));
  await revokeInviteCode(z.string().regex(ID_PATTERN.invite).parse(params.code));
  return { revoked: true };
});
