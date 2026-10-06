import { z } from "zod";
import { ID_PATTERN } from "@/domain/ids";
import { deviceOf } from "@/server/auth/current";
import { requireActive } from "@/server/auth/device-session";
import { ApiError } from "@/server/http/api-error";
import { apiHandler } from "@/server/http/api-handler";
import { signOutDevice } from "@/server/services/profile.service";

/** Signs another device out of the active account (this device uses the sign-out button). */
export const DELETE = apiHandler<{ signedOut: true }, { id: string }>(async ({ req, params }) => {
  const { account, sessionId } = requireActive(await deviceOf(req));
  const id = z.string().regex(ID_PATTERN.session).parse(params.id);
  if (id === sessionId) throw new ApiError("BAD_REQUEST", "Use Sign out for this device.");
  await signOutDevice(account.id, id);
  return { signedOut: true };
});
