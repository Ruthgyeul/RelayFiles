import { createCollectionSchema } from "@/contracts/collections";
import { ok } from "@/server/http/api-handler";
import { apiV1Handler } from "@/server/http/api-v1-handler";
import { collectionsOf, createCollectionFor } from "@/server/services/collection.service";

/** The token account's collection links, newest first. */
export const GET = apiV1Handler("files:read", async ({ caller }) => collectionsOf(caller.account));

/** Shares several files and folders as one link. */
export const POST = apiV1Handler("files:write", async ({ req, caller }) => ok(await createCollectionFor(caller.account, createCollectionSchema.parse(await req.json())), { status: 201 }));
