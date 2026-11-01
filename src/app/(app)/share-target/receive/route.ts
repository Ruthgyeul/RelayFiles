import { SHARE_TARGET } from "@/config/policy";
import { apiHandler } from "@/server/http/api-handler";

/**
 * The share sheet's post when no service worker took it (the worker is not installed or running
 * yet, or the site is plain http). Nothing is read or stored: browsers do not send the
 * SameSite=Lax session cookie with a post another app or site started, so the owner of the files
 * is unknown, and a post from another site must never write into anyone's Home. The body is left
 * unread and the browser is sent to the share page, which explains what to do (303: as a GET).
 */
export const POST = apiHandler(async () => new Response(null, { status: 303, headers: { location: `${SHARE_TARGET.page}?error=unavailable`, "cache-control": "no-store" } }));
