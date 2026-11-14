import "server-only";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { getEnv } from "@/config/env";
import { IMMUTABLE_CACHE, TRANSCODE } from "@/config/policy";
import { segmentName, segmentPlan } from "@/domain/hls";
import { ApiError } from "../http/api-error";
import { logger } from "../logger";
import { acquireConversion, hlsArgs, type ConversionSlots } from "./transcode";

/**
 * HLS playback sessions (docs/architecture.md "미리보기 전송"): one per video and requester, in
 * this process's memory, with its segments in a folder of the volume's upload area. A session
 * runs at most one ffmpeg at a time, from the segment the player needs: a seek far from what
 * it wrote starts it again there. It pauses once it is far ahead of the player, deletes the
 * segments far behind, and ends (ffmpeg stopped, folder removed) when the player stops asking.
 * A crash leaves the folder to the daily cleanup of the upload area.
 */

interface Run {
  start: number;
  child: ChildProcess;
  running: boolean;
  closed: Promise<void>;
  startedAt: number;
}

interface Session {
  key: string;
  dir: string;
  path: string;
  requester: string;
  run: Run | null;
  /** Restarts happen one at a time (two requests may both find the segment missing). */
  starting: Promise<void> | null;
  lastUsedAt: number;
  lastIndex: number;
}

/** What a segment request needs to know about the video. */
export interface HlsSource {
  /** Identifies the video and its content (node id and hash): a new version gets new sessions. */
  key: string;
  /** The original on the volume. */
  path: string;
  /** Who the conversion is counted against (an account, or a link visitor's address). */
  requester: string;
  /** A new folder in the volume's upload area for the session's segments. */
  newDir: () => Promise<string>;
}

const globalForHls = globalThis as unknown as { relayHlsSessions?: Map<string, Session>; relayHlsSweep?: NodeJS.Timeout };
const sessions = (globalForHls.relayHlsSessions ??= new Map());

/** HLS sessions open in this process. */
export const openHlsSessions = () => sessions.size;

function stopRun(run: Run | null): Promise<void> {
  if (!run) return Promise.resolve();
  if (run.child.exitCode === null && run.child.signalCode === null) run.child.kill("SIGKILL");
  return run.closed;
}

async function endSession(session: Session): Promise<void> {
  sessions.delete(session.key);
  await stopRun(session.run);
  await rm(session.dir, { recursive: true, force: true }).catch((error: unknown) => logger.warn("HLS segments not removed", { error }));
}

/** Starts ffmpeg for `session` at segment `start`, holding conversion slots while it runs (429 when there are none). */
async function startRun(session: Session, start: number, slots: ConversionSlots): Promise<void> {
  const child = spawn(getEnv("jobs").FFMPEG_PATH, hlsArgs(session.path, session.dir, start), { stdio: ["ignore", "ignore", "pipe"], shell: false });
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    if (stderr.length < TRANSCODE.hlsErrorLogBytes) stderr += chunk.toString().slice(0, TRANSCODE.hlsErrorLogBytes - stderr.length);
  });
  const lost = () => {
    logger.warn("HLS conversion stopped: its conversion slot was lost");
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  };
  for (const signal of slots.signals) signal.addEventListener("abort", lost, { once: true });
  const run: Run = {
    start,
    child,
    running: true,
    startedAt: Date.now(),
    closed: new Promise((resolve) => {
      child.once("error", (error) => logger.warn("HLS conversion could not start", { error }));
      child.once("close", (code, signal) => {
        run.running = false;
        for (const abort of slots.signals) abort.removeEventListener("abort", lost);
        slots.release();
        if (code !== 0 && signal !== "SIGKILL") logger.warn("HLS conversion failed", { code, signal, detail: stderr.trim() });
        resolve();
      });
    }),
  };
  session.run = run;
}

/** Stops what runs and starts at `index` (one restart at a time per session). */
async function restartAt(session: Session, index: number): Promise<void> {
  while (session.starting) await session.starting;
  // Another request restarted it meanwhile, at or before this segment.
  if (session.run?.running && session.run.start <= index && index - session.run.start <= TRANSCODE.hlsAheadSegments) return;
  session.starting = (async () => {
    await stopRun(session.run);
    session.run = null;
    // Slots are taken only once the old conversion gave its own back.
    const slots = await acquireConversion(session.requester);
    try {
      await startRun(session, index, slots);
    } catch (error) {
      slots.release();
      throw error;
    }
  })();
  try {
    await session.starting;
  } finally {
    session.starting = null;
  }
}

/** Deletes segments far behind the player (seeking back converts them again). */
async function pruneBehind(session: Session, index: number): Promise<void> {
  const before = index - TRANSCODE.hlsKeepBehindSegments;
  if (before <= 0) return;
  const names = await readdir(session.dir).catch(() => [] as string[]);
  await Promise.all(
    names.filter((name) => /^\d+\.ts$/.test(name) && Number.parseInt(name, 10) < before).map((name) => rm(join(session.dir, name), { force: true })),
  );
}

async function sessionFor(source: HlsSource): Promise<Session> {
  const existing = sessions.get(source.key);
  if (existing) return existing;
  const dir = await source.newDir();
  await mkdir(dir, { recursive: true });
  // Another request may have opened it while the folder was made.
  const raced = sessions.get(source.key);
  if (raced) {
    await rm(dir, { recursive: true, force: true });
    return raced;
  }
  const session: Session = { key: source.key, dir, path: source.path, requester: source.requester, run: null, starting: null, lastUsedAt: Date.now(), lastIndex: 0 };
  sessions.set(source.key, session);
  ensureSweep();
  return session;
}

/**
 * Segment `index` of the video converted for HLS, converting it first when it is not written
 * yet: waits up to TRANSCODE.hlsSegmentWaitMs (then 503, the player asks again), 429 when no
 * conversion slot is free. `onServe` is told the bytes sent.
 */
export async function hlsSegment(source: HlsSource, index: number, onServe?: (bytes: number) => void): Promise<Response> {
  const session = await sessionFor(source);
  const file = join(session.dir, segmentName(index));
  const written = (segment: number) => existsSync(join(session.dir, segmentName(segment)));
  const deadline = Date.now() + TRANSCODE.hlsSegmentWaitMs;
  session.lastIndex = index;
  while (!written(index)) {
    session.lastUsedAt = Date.now();
    const plan = segmentPlan(session.run && { start: session.run.start, running: session.run.running }, index, TRANSCODE.hlsAheadSegments, written);
    if (plan === "failed") throw new ApiError("INTERNAL");
    if (plan === "restart") await restartAt(session, index);
    else if (Date.now() >= deadline) throw new ApiError("VIDEO_CONVERTING", undefined, { retryAfter: TRANSCODE.hlsRetrySec });
    else await sleep(TRANSCODE.hlsPollMs);
  }
  session.lastUsedAt = Date.now();
  const body = await readFile(file).catch(() => null);
  // Deleted behind the player by another request in between: the player asks again.
  if (!body) throw new ApiError("VIDEO_CONVERTING", undefined, { retryAfter: TRANSCODE.hlsRetrySec });
  void pruneBehind(session, index);
  onServe?.(body.length);
  // The playlist names segments with the video's version, so a cached one is never stale.
  return new Response(new Uint8Array(body), { headers: { "content-type": "video/mp2t", "content-length": String(body.length), "cache-control": IMMUTABLE_CACHE, "x-content-type-options": "nosniff" } });
}

/** Ends idle sessions, pauses conversions far ahead of their player or running too long. */
async function sweep(now: number): Promise<void> {
  for (const session of [...sessions.values()]) {
    if (now - session.lastUsedAt >= TRANSCODE.hlsIdleMs) {
      await endSession(session);
      continue;
    }
    const run = session.run;
    if (!run?.running) continue;
    const ahead = existsSync(join(session.dir, segmentName(session.lastIndex + TRANSCODE.hlsMaxAheadSegments)));
    if (ahead || now - run.startedAt >= TRANSCODE.maxRunMs) await stopRun(run);
  }
  if (sessions.size === 0 && globalForHls.relayHlsSweep) {
    clearInterval(globalForHls.relayHlsSweep);
    globalForHls.relayHlsSweep = undefined;
  }
}

function ensureSweep(): void {
  if (globalForHls.relayHlsSweep) return;
  globalForHls.relayHlsSweep = setInterval(() => {
    sweep(Date.now()).catch((error: unknown) => logger.warn("HLS sessions not checked", { error }));
  }, TRANSCODE.watchIntervalMs);
  globalForHls.relayHlsSweep.unref();
}

/** Ends every session now (shutdown, tests): ffmpeg is stopped and the segments removed. */
export async function endHlsSessions(): Promise<void> {
  await Promise.all([...sessions.values()].map(endSession));
}

/** Runs the sweep at `now` (tests). */
export const sweepHlsSessions = (now: number) => sweep(now);

// ffmpeg writes files, not a pipe, so it would outlive a stopped app process: stop it on exit.
process.once("exit", () => {
  for (const session of sessions.values()) if (session.run?.running) session.run.child.kill("SIGKILL");
});
