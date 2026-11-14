import { timelineQuerySchema } from "@/contracts/timeline";
import { apiHandler } from "@/server/http/api-handler";
import { timeline } from "@/server/services/timeline.service";

/** "Photos": the active account's photos and videos by the date they were taken, one page per request. */
export const GET = apiHandler({ auth: "active" }, async ({ req, active: { account } }) => {
  return timeline(account.id, timelineQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams)));
});
