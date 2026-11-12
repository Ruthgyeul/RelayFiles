import { apiV1Handler } from "@/server/http/api-v1-handler";
import { sharedItems } from "@/server/services/shared-items.service";

/** Everything of the token account that can be opened from outside ("Shared by me"). */
export const GET = apiV1Handler("files:read", async ({ caller }) => sharedItems(caller.account.id));
