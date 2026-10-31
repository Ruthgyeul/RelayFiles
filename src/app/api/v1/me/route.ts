import { apiV1Handler } from "@/server/http/api-v1-handler";
import { apiAccount } from "@/server/services/api-v1.service";

/** The token's account, its storage use and the token's scopes (any valid token). */
export const GET = apiV1Handler(null, async ({ caller }) => apiAccount(caller));
