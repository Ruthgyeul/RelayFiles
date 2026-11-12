import { describe, expectTypeOf, it } from "vitest";
import type { z } from "zod";
import type { ApiV1Account, ApiV1Share, ApiV1UploadedFile } from "./api-tokens";
import { apiV1AccountSchema, apiV1ShareSchema, apiV1UploadedFileSchema, createdFolderSchema, favoritesViewSchema, folderViewSchema, nodeItemSchema, taggedItemSchema } from "./api-v1";
import type { FavoritesView } from "./favorites";
import type { CreatedFolder, FolderView, NodeItem, TaggedItem } from "./nodes";

// Checked by the type checker (npm run typecheck): a field added to a type and not to its
// schema, or the other way round, fails here before docs/openapi.json can go out of date.
describe("API v1 response schemas", () => {
  it("describe exactly the types the routes send", () => {
    expectTypeOf<z.infer<typeof nodeItemSchema>>().toEqualTypeOf<NodeItem>();
    expectTypeOf<z.infer<typeof folderViewSchema>>().toEqualTypeOf<FolderView>();
    expectTypeOf<z.infer<typeof createdFolderSchema>>().toEqualTypeOf<CreatedFolder>();
    expectTypeOf<z.infer<typeof taggedItemSchema>>().toEqualTypeOf<TaggedItem>();
    expectTypeOf<z.infer<typeof apiV1AccountSchema>>().toEqualTypeOf<ApiV1Account>();
    expectTypeOf<z.infer<typeof apiV1UploadedFileSchema>>().toEqualTypeOf<ApiV1UploadedFile>();
    expectTypeOf<z.infer<typeof apiV1ShareSchema>>().toEqualTypeOf<ApiV1Share>();
    expectTypeOf<z.infer<typeof favoritesViewSchema>>().toEqualTypeOf<FavoritesView>();
  });
});
