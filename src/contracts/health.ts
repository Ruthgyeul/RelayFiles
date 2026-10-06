import { z } from "zod";

export const componentStatus = z.enum(["ok", "degraded", "down"]);
export type ComponentStatus = z.infer<typeof componentStatus>;

/** GET /api/health response data. */
export const healthSchema = z.object({
  status: componentStatus,
  version: z.string(),
  time: z.string(),
  components: z.object({
    database: componentStatus,
    redis: componentStatus,
    storage: componentStatus,
  }),
});
export type Health = z.infer<typeof healthSchema>;
