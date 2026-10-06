import { apiHandler } from "@/server/http/api-handler";
import { statusData } from "@/server/services/status.service";

export const dynamic = "force-dynamic";

/** Public Status page data: probe history, service strips, server info and incidents. */
export const GET = apiHandler(() => statusData());
