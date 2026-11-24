import { createCollectionSchema } from "@/contracts/collections";
import { apiHandler, ok } from "@/server/http/api-handler";
import { collectionsOf, createCollectionFor } from "@/server/services/collection.service";

/** The account's collection links, newest first. */
export const GET = apiHandler({ auth: "active" }, async ({ active: { account } }) => collectionsOf(account));

/** Shares several files and folders as one link. */
export const POST = apiHandler({ auth: "active" }, async ({ req, active: { account } }) => ok(await createCollectionFor(account, createCollectionSchema.parse(await req.json())), { status: 201 }));
