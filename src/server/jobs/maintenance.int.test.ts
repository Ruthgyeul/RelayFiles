import { randomUUID } from "node:crypto";
import { Queue, Worker } from "bullmq";
import { afterAll, describe, expect, it } from "vitest";
import { JOBS } from "@/config/policy";
import { KEEP_HISTORY, MAINTENANCE_QUEUE, PROBES_QUEUE, scheduleMaintenance, trimFinishedJobs } from "./maintenance";
import { queueConnection } from "./queue";

const queues: Queue[] = [];
const open = (name: string) => {
  const queue = new Queue(name, queueConnection("worker"));
  queues.push(queue);
  return queue;
};

afterAll(async () => {
  for (const queue of queues) {
    await queue.obliterate({ force: true });
    await queue.close();
  }
});

/** Runs `count` jobs on a throwaway queue whose jobs keep the maintenance history settings. */
async function finish(count: number): Promise<Queue> {
  const name = `test-${randomUUID()}`;
  const queue = open(name);
  const worker = new Worker(name, async () => null, { ...queueConnection("worker"), concurrency: JOBS.probeConcurrency });
  try {
    await queue.addBulk(Array.from({ length: count }, (_, index) => ({ name: "probe", data: { index }, opts: KEEP_HISTORY })));
    const unfinished = async () => {
      const counts = await queue.getJobCounts("waiting", "active");
      return (counts.waiting ?? 0) + (counts.active ?? 0);
    };
    await expect.poll(unfinished, { timeout: 15_000 }).toBe(0);
  } finally {
    await worker.close();
  }
  return queue;
}

describe("maintenance queues", () => {
  it("puts the cleanup alone on its queue and moves the probes off it", async () => {
    const cleanup = open(MAINTENANCE_QUEUE);
    const probes = open(PROBES_QUEUE);
    // What an older release left: the volume watch on the cleanup's queue.
    await cleanup.upsertJobScheduler("volume-watch", { every: 30_000 }, { name: "volumes" });

    await scheduleMaintenance(cleanup, probes);
    await scheduleMaintenance(cleanup, probes); // every start runs it again

    const ids = async (queue: Queue) => (await queue.getJobSchedulers()).map((scheduler) => scheduler.key).sort();
    expect(await ids(cleanup)).toEqual(["daily-cleanup"]);
    expect(await ids(probes)).toEqual(["health-probe", "metrics-sample", "volume-watch"]);
    for (const scheduler of [...(await cleanup.getJobSchedulers()), ...(await probes.getJobSchedulers())]) {
      expect(scheduler.template?.opts).toMatchObject(KEEP_HISTORY);
    }
  });

  it("keeps only the newest finished jobs", async () => {
    const done = await finish(JOBS.keepCompleted + 20);
    expect(await done.getCompletedCount()).toBe(JOBS.keepCompleted);
  });

  it("removes finished jobs left by older releases in batches", async () => {
    const name = `test-${randomUUID()}`;
    const queue = open(name);
    const worker = new Worker(name, async () => null, { ...queueConnection("worker") });
    try {
      // Jobs without a history limit, as releases before KEEP_HISTORY added them.
      await queue.addBulk(Array.from({ length: 5 }, (_, index) => ({ name: "probe", data: { index } })));
      await expect.poll(() => queue.getCompletedCount(), { timeout: 15_000 }).toBe(5);
    } finally {
      await worker.close();
    }
    // Younger than the cut-off: kept.
    expect(await trimFinishedJobs(queue)).toBe(0);
    expect(await trimFinishedJobs(queue, 0)).toBe(5);
    expect(await queue.getCompletedCount()).toBe(0);
  });
});
