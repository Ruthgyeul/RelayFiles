import { z } from "zod";

export const componentStatus = z.enum(["ok", "degraded", "down"]);
export type ComponentStatus = z.infer<typeof componentStatus>;

/** GET /api/health response data. */
export const healthSchema = z.object({
  status: componentStatus,
  /** No longer sent (the probe answers without logging in); kept optional for older readers. */
  version: z.string().optional(),
  time: z.string(),
  components: z.object({
    database: componentStatus,
    redis: componentStatus,
    storage: componentStatus,
    /** clamd, when CLAMAV_HOST is set (files received through upload links wait for it). */
    scanner: componentStatus.optional(),
  }),
});
export type Health = z.infer<typeof healthSchema>;
