import type { paths } from "./openapi.ts";

type Method = "get" | "post" | "patch" | "delete";

/** The `data` of an endpoint's success answer (200 or 201), from docs/openapi.json. */
export type Data<P extends keyof paths, M extends Method> = paths[P][M] extends { responses: infer R }
  ? R extends { 200: { content: { "application/json": { data: infer D } } } }
    ? D
    : R extends { 201: { content: { "application/json": { data: infer D } } } }
      ? D
      : never
  : never;

/** The JSON body an endpoint takes. */
export type Body<P extends keyof paths, M extends Method> = paths[P][M] extends { requestBody?: { content: { "application/json": infer B } } } ? B : never;

export type Account = Data<"/api/v1/me", "get">;
export type FolderView = Data<"/api/v1/folders/{id}", "get">;
export type NodeItem = FolderView["children"][number];
export type Share = Data<"/api/v1/nodes/{id}/share", "get">;
export type SharePatch = Body<"/api/v1/nodes/{id}/share", "patch">;
export type FileVersion = Data<"/api/v1/files/{id}/versions", "get">[number];
export type SharedView = Data<"/api/v1/shares", "get">;
export type PreparedUpload = Data<"/api/v1/uploads", "post">;
