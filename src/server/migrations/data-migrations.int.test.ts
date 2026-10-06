import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { runDataMigrations, type DataMigrationStep } from "@/server/migrations/data-migrations";

const migrationIds: string[] = [];

afterAll(async () => {
  await db().dataMigration.deleteMany({ where: { id: { in: migrationIds } } });
});

describe("data migrations", () => {
  it("resume from the saved cursor and never run twice", async () => {
    const id = `test-${Date.now()}`;
    migrationIds.push(id);
    const seen: string[] = [];
    let fail = true;
    const step: DataMigrationStep = {
      id,
      description: "walks three batches",
      async run({ cursor, save }) {
        for (const batch of ["a", "b", "c"].filter((name) => !cursor || name > cursor)) {
          if (batch === "b" && fail) throw new Error("interrupted");
          seen.push(batch);
          await save(batch);
        }
      },
    };
    await expect(runDataMigrations(db(), [step])).rejects.toThrow("interrupted");
    expect((await db().dataMigration.findUniqueOrThrow({ where: { id } })).cursor).toBe("a");

    fail = false;
    expect(await runDataMigrations(db(), [step])).toEqual({ ran: [id], skipped: [] });
    expect(seen).toEqual(["a", "b", "c"]);
    expect(await runDataMigrations(db(), [step])).toEqual({ ran: [], skipped: [id] });
    expect((await db().dataMigration.findUniqueOrThrow({ where: { id } })).finishedAt).not.toBeNull();
  });
});
