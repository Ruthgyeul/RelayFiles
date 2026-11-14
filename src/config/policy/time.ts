/** Time units. Part of the product policy (src/config/policy.ts). */

export const MS = { second: 1_000, minute: 60_000, hour: 3_600_000, day: 86_400_000 } as const;

/** The same units in seconds (cookie ages, Redis TTLs, Retry-After). */
export const SECONDS = { minute: MS.minute / MS.second, hour: MS.hour / MS.second, day: MS.day / MS.second } as const;
