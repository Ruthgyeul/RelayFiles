import { readLocalSetting, writeLocalSetting } from "@/shared/lib/local-setting";

/**
 * Playback positions per file (design `relay.resume`): saved after 3 s of playback,
 * forgotten within the last 5 s, written at most every 800 ms.
 */
export interface ResumePoint {
  /** Seconds played. */
  t: number;
  /** Duration in seconds. */
  d: number;
}

const KEY = "relay.resume";
const MIN_SECONDS = 3;
const END_MARGIN_SECONDS = 5;
const SAVE_DELAY_MS = 800;

type Store = Record<string, ResumePoint>;
const isStore = (value: unknown): value is Store => typeof value === "object" && value !== null && !Array.isArray(value);

let cache: Store | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function store(): Store {
  cache ??= readLocalSetting(KEY, isStore) ?? {};
  return cache;
}

function save() {
  clearTimeout(timer);
  timer = setTimeout(() => writeLocalSetting(KEY, store()), SAVE_DELAY_MS);
  for (const listener of listeners) listener();
}

export const resumeStore = {
  get: (id: string): ResumePoint | undefined => store()[id],
  /** Records the position of a playing media element (design `trackTime`). */
  track(id: string, media: HTMLMediaElement) {
    if (!media.duration || !Number.isFinite(media.duration)) return;
    if (media.duration - media.currentTime <= END_MARGIN_SECONDS) delete store()[id];
    else if (media.currentTime > MIN_SECONDS) store()[id] = { t: media.currentTime, d: media.duration };
    else return;
    save();
  },
  /** Seeks to the saved position; returns it when it did (design `restoreTime`). */
  restore(id: string, media: HTMLMediaElement): number | null {
    const point = store()[id];
    if (!point || !media.duration || point.t >= media.duration - END_MARGIN_SECONDS) return null;
    media.currentTime = point.t;
    return point.t;
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
