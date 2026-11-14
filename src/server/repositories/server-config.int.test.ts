import { describe, expect, it } from "vitest";
import { countQueries } from "../../../test/query-counter";

// Before anything uses db().
const { client, measure } = countQueries();
const { getServerConfig } = await import("./server-config.repo");

describe("server settings row", () => {
  it("is only read once it exists (pages read it on every request)", async () => {
    await getServerConfig(client);
    const { result, statements } = await measure(() => getServerConfig(client));
    expect(result).toHaveProperty("signupMode");
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatch(/^SELECT/);
  });
});
