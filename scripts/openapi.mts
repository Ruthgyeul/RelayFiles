/**
 * Writes docs/openapi.json, the OpenAPI 3.1 description of /api/v1, from the route registry
 * (src/contracts/api-v1-routes.ts) and the zod schemas the routes validate with.
 *
 *   npm run openapi          # regenerate docs/openapi.json
 *   npm run check:openapi    # fail when docs/openapi.json is not what the code describes
 */
import { readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { APP_VERSION } from "../src/config/version";
import { API_SCOPE_LABEL } from "../src/contracts/api-tokens";
import { API_V1_ROUTES, type ApiV1Route } from "../src/contracts/api-v1-routes";
import { ERRORS } from "../src/contracts/errors";

const OUTPUT = "docs/openapi.json";

type Json = Record<string, unknown>;

/** JSON Schema of a request (`input`: what is sent) or response (`output`) schema. */
function schemaOf(schema: z.ZodType, io: "input" | "output"): Json {
  const { $schema: _dialect, ...rest } = z.toJSONSchema(schema, { io, unrepresentable: "any" }) as Json;
  return rest;
}

const errorBody: Json = {
  type: "object",
  required: ["success", "error", "code"],
  properties: {
    success: { const: false },
    error: { type: "string", description: "Message safe to show" },
    code: { enum: Object.keys(ERRORS) },
    fields: { type: "object", additionalProperties: { type: "string" }, description: "Messages per invalid field" },
    retryAfter: { type: "integer", description: "Seconds until a rate-limited request may be retried" },
  },
};

const errorResponse = (description: string) => ({ description, content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } });

function operation(route: ApiV1Route): Json {
  const parameters = [
    ...Object.entries(route.params ?? {}).map(([name, description]) => ({ name, in: "path", required: true, description, schema: { type: "string" } })),
    ...Object.entries(route.query?.shape ?? {}).map(([name, field]) => {
      const schema = schemaOf(field as z.ZodType, "input");
      return { name, in: "query", required: !(field as z.ZodType).safeParse(undefined).success, ...(typeof schema.description === "string" ? { description: schema.description } : {}), schema };
    }),
  ];
  const ok =
    route.response === "file"
      ? { description: "The file's bytes (206 for a Range request)", content: route.method === "HEAD" ? undefined : { "application/octet-stream": { schema: { type: "string", format: "binary" } } } }
      : {
          description: "Success",
          content: { "application/json": { schema: { type: "object", required: ["success", "data"], properties: { success: { const: true }, data: schemaOf(route.response, "output") } } } },
        };
  return {
    summary: route.summary,
    ...(route.description ? { description: route.description } : {}),
    ...(route.scope ? { "x-scope": route.scope } : {}),
    security: [{ apiToken: route.scope ? [route.scope] : [] }],
    ...(parameters.length ? { parameters } : {}),
    ...(route.body
      ? {
          requestBody: {
            required: true,
            content: route.body === "binary" ? { "application/octet-stream": { schema: { type: "string", format: "binary" } } } : { "application/json": { schema: schemaOf(route.body, "input") } },
          },
        }
      : {}),
    responses: {
      [String(route.status)]: ok,
      "400": errorResponse("Invalid request"),
      "401": errorResponse("Missing, unknown or expired API token"),
      "403": errorResponse("The token lacks the scope, or the account may not do this"),
      "404": errorResponse("Not found (also another account's item)"),
      "429": errorResponse("Too many requests (Retry-After)"),
    },
  };
}

function document(): Json {
  const paths: Record<string, Json> = {};
  for (const route of API_V1_ROUTES) (paths[route.path] ??= {})[route.method.toLowerCase()] = operation(route);
  return {
    openapi: "3.1.0",
    info: {
      title: "RelayFiles API",
      version: APP_VERSION,
      description: "Personal API tokens (Profile → API tokens) for scripts and apps. Responses are `{ success: true, data }` or `{ success: false, error, code }` (docs/api.md).",
    },
    servers: [{ url: "/", description: "This server (PUBLIC_URL)" }],
    components: {
      securitySchemes: {
        apiToken: {
          type: "http",
          scheme: "bearer",
          description: `\`Authorization: Bearer rfp_…\`. Scopes: ${Object.entries(API_SCOPE_LABEL)
            .map(([scope, label]) => `${scope} (${label})`)
            .join(", ")}.`,
        },
      },
      schemas: { Error: errorBody },
    },
    paths,
  };
}

const text = `${JSON.stringify(document(), null, 2)}\n`;
if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(OUTPUT, "utf8");
  } catch {
    // Missing counts as out of date.
  }
  if (current !== text) {
    console.error(`${OUTPUT} is out of date with src/contracts/api-v1-routes.ts. Run npm run openapi and commit the result.`);
    process.exit(1);
  }
  console.log(`${OUTPUT} is up to date`);
} else {
  writeFileSync(OUTPUT, text);
  console.log(`Wrote ${OUTPUT} (${API_V1_ROUTES.length} operations)`);
}
