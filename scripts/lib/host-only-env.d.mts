/** Types of host-only-env.mjs (plain JavaScript: scripts/start-server.mjs runs without tsx). */
export declare function dropHostOnlyEnv(env?: NodeJS.ProcessEnv): void;
/** Settings only the host's own scripts read; the app, the worker, compose and k3s drop them. */
export declare const HOST_ONLY_ENV: readonly string[];
