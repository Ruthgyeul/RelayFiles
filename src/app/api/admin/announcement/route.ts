import { announcementSchema } from "@/contracts/server-settings";
import { clientInfo } from "@/server/auth/client-info";
import { deviceOf } from "@/server/auth/current";
import { requireAdmin } from "@/server/auth/device-session";
import { apiHandler } from "@/server/http/api-handler";
import { audit } from "@/server/services/audit.service";
import { announce, takeDownAnnouncement } from "@/server/services/server-settings.service";

/** Publishes the announcement shown at the top of every account's File Manager. */
export const POST = apiHandler(async ({ req }) => {
  const admin = requireAdmin(await deviceOf(req));
  const { text, level } = announcementSchema.parse(await req.json());
  await announce(text, level);
  await audit(admin, clientInfo(req.headers), "announcement.publish", { detail: level });
  return { published: true };
});

/** Takes the live announcement down. */
export const DELETE = apiHandler(async ({ req }) => {
  const admin = requireAdmin(await deviceOf(req));
  await takeDownAnnouncement();
  await audit(admin, clientInfo(req.headers), "announcement.remove");
  return { removed: true };
});
