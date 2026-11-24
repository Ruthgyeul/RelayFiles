import { collectionIdSchema, updateCollectionSchema } from "@/contracts/collections";
import { apiHandler } from "@/server/http/api-handler";
import { deleteCollectionFor, updateCollectionFor } from "@/server/services/collection.service";

/** Changes a collection's settings or replaces its items. */
export const PATCH = apiHandler<unknown, { id: string }>({ auth: "active" }, async ({ req, params, active: { account } }) =>
  updateCollectionFor(account, collectionIdSchema.parse(params.id), updateCollectionSchema.parse(await req.json())),
);

/** Deletes a collection link (its items stay as they are). */
export const DELETE = apiHandler<unknown, { id: string }>({ auth: "active" }, async ({ params, active: { account } }) => deleteCollectionFor(account, collectionIdSchema.parse(params.id)));
