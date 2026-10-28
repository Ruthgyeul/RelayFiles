import { getEnv } from "@/config/env";
import { fileRequestIdSchema } from "@/contracts/file-requests";
import { unlockSchema } from "@/contracts/share";
import { clientInfo } from "@/server/auth/client-info";
import { apiHandler, ok } from "@/server/http/api-handler";
import { unlockRequest } from "@/server/services/file-request.service";
import { UNLOCK_COOKIE, UNLOCK_COOKIE_MAX_AGE } from "@/server/share/unlock-cookie";
import { unlocksOfRequest } from "@/server/share/viewer";

/** Enters an upload-only link's password on this device (the share unlock cookie remembers it). */
export const POST = apiHandler<Response, { id: string }>(async ({ req, params }) => {
  const id = fileRequestIdSchema.parse(params.id);
  const { password } = unlockSchema.parse(await req.json());
  const now = Date.now();
  const cookie = await unlockRequest(id, password, unlocksOfRequest(req, now), clientInfo(req.headers), now);
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
