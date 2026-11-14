import "server-only";
import type { Redis } from "ioredis";
import { logger } from "../logger";
import { channelName, redis } from "../redis";

/**
 * "Something in this account changed": published by every process that writes files (the app,
 * the WebDAV server, the worker, storage:import), heard by the app process that holds the
 * account's open pages (GET /api/events). The message carries nothing else: a page that hears
 * it reloads what it shows through its usual, access-checked requests.
 */
const channelOf = (accountId: string) => channelName(`events:account:${accountId}`);

/** Tells open pages of the account that its files changed. Never fails the caller. */
export function publishAccountChange(accountId: string): void {
  redis()
    .publish(channelOf(accountId), "changed")
    .catch((error: unknown) => logger.warn("account change not published", { error }));
}

type Listener = () => void;

/** One subscriber connection per process, shared by every open stream of every account. */
const globalForEvents = globalThis as unknown as { relayAccountEvents?: { subscriber: Redis; listeners: Map<string, Set<Listener>> } };

function hub() {
  if (!globalForEvents.relayAccountEvents) {
    const subscriber = redis().duplicate();
    const listeners = new Map<string, Set<Listener>>();
    subscriber.on("message", (channel: string) => {
      for (const listener of listeners.get(channel) ?? []) listener();
    });
    subscriber.on("error", (error: unknown) => logger.warn("account events connection failed", { error }));
    globalForEvents.relayAccountEvents = { subscriber, listeners };
  }
  return globalForEvents.relayAccountEvents;
}

/** Calls `listener` whenever the account changes; returns the function that stops it. */
export async function subscribeAccount(accountId: string, listener: Listener): Promise<() => Promise<void>> {
  const { subscriber, listeners } = hub();
  const channel = channelOf(accountId);
  let set = listeners.get(channel);
  if (!set) {
    set = new Set();
    listeners.set(channel, set);
    await subscriber.subscribe(channel);
  }
  set.add(listener);
  return async () => {
    const current = listeners.get(channel);
    if (!current) return;
    current.delete(listener);
    if (current.size > 0) return;
    listeners.delete(channel);
    await subscriber.unsubscribe(channel).catch((error: unknown) => logger.warn("account events not unsubscribed", { error }));
  };
}
