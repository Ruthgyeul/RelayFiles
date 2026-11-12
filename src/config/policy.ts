/**
 * Product policy constants (single source). Deployment-specific overrides come from
 * `.env` through src/config/env.ts, which uses these values as defaults.
 */

// Split by area under src/config/policy/; import from "@/config/policy" as before.
export * from "./policy/time";
export * from "./policy/accounts";
export * from "./policy/storage";
export * from "./policy/files";
export * from "./policy/share";
export * from "./policy/media";
export * from "./policy/operations";
export * from "./policy/deploy";
