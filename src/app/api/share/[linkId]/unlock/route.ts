import { getEnv } from "@/config/env";
import { linkIdSchema, unlockSchema } from "@/contracts/share";
import { clientInfo } from "@/server/auth/client-info";
import { apiHandler, ok } from "@/server/http/api-handler";
import { unlockShare } from "@/server/services/share.service";
import { UNLOCK_COOKIE, UNLOCK_COOKIE_MAX_AGE } from "@/server/share/unlock-cookie";
import { shareViewerOf } from "@/server/share/viewer";

/** Unlocks a password-protected link on this device (remembered in a signed cookie). */
export const POST = apiHandler<Response, { linkId: string }>(async ({ req, params }) => {
  const linkId = linkIdSchema.parse(params.linkId);
  const { password } = unlockSchema.parse(await req.json());
  const now = Date.now();
  const cookie = await unlockShare(linkId, password, await shareViewerOf(req, now), clientInfo(req.headers), now);
  const response = ok({ unlocked: true });
  response.cookies.set(UNLOCK_COOKIE, cookie, {
    httpOnly: true,
    sameSite: "lax",
    secure: getEnv("app").PUBLIC_URL.startsWith("https:"),
    path: "/",
    maxAge: UNLOCK_COOKIE_MAX_AGE,
  });
  return response;
});
