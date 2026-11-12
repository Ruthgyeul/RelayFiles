import "server-only";
import { getEnv } from "@/config/env";
import { ipInCidrs } from "@/domain/network";
import { requestIp } from "./client-info";

/**
 * Whether a request comes from where admin pages and APIs may be used (ADMIN_ALLOWED_CIDRS;
 * empty = anywhere). The proxy refuses other addresses first; this is checked again with the
 * session so an admin route is never reachable around the proxy's matcher.
 */
export function fromAdminNetwork(headers: Pick<Headers, "get">): boolean {
  const allowed = getEnv("app").ADMIN_ALLOWED_CIDRS;
  return allowed.length === 0 || ipInCidrs(requestIp(headers), allowed);
}
