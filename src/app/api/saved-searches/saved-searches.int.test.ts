import { afterAll, describe, expect, it } from "vitest";
import { SEARCH } from "@/config/policy";
import type { SavedSearchDto } from "@/contracts/saved-searches";
import { callRoute } from "../../../../test/route-call";
import { fileFixtures } from "../../../../test/file-fixtures";
import { DELETE } from "./[id]/route";
import { GET, POST } from "./route";

const { prisma, member, cleanup } = fileFixtures();
afterAll(cleanup);

type Member = Awaited<ReturnType<typeof member>>;
const list = async (m: Member) => (await callRoute<SavedSearchDto[]>(GET, { cookie: m.cookie })).json.data;
const save = (m: Member, query: string) => callRoute<SavedSearchDto>(POST, { method: "POST", cookie: m.cookie, body: { query } });
const remove = (m: Member, id: string) => callRoute<{ deleted: true }, { id: string }>(DELETE, { method: "DELETE", cookie: m.cookie, params: { id } });

describe("saved searches", () => {
  it("keeps a search once in its normalized form and deletes it", async () => {
    const m = await member();
    const first = await save(m, "  Beach #Trip type:image newer:2w ");
    expect(first.status).toBe(200);
    expect(first.json.data.query).toBe("#trip type:image newer:14d beach");
    // The same search typed differently is the same saved search.
    expect((await save(m, "newer:14d type:image #trip beach")).json.data.id).toBe(first.json.data.id);
    await save(m, "#work");
    expect((await list(m)).map((search) => search.query)).toEqual(["#trip type:image newer:14d beach", "#work"]);

    expect((await save(m, "   ")).status).toBe(400);
    expect((await remove(m, first.json.data.id)).status).toBe(200);
    expect((await list(m)).map((search) => search.query)).toEqual(["#work"]);
  });

  it("keeps each account's searches to itself", async () => {
    const m = await member();
    const other = await member();
    const mine = (await save(m, "report")).json.data;
    expect(await list(other)).toEqual([]);
    expect((await remove(other, mine.id)).status).toBe(404);
    expect((await list(m)).map((search) => search.id)).toEqual([mine.id]);
  });

  it(`stops at ${SEARCH.maxSaved} searches`, async () => {
    const m = await member();
    await prisma.savedSearch.createMany({ data: Array.from({ length: SEARCH.maxSaved }, (_, index) => ({ id: `s${String(index).padStart(11, "a")}`.slice(0, 12), accountId: m.id, query: `q${index}` })) });
    const refused = await save(m, "one more");
    expect(refused.status).toBe(400);
    expect(refused.json.error).toContain(`up to ${SEARCH.maxSaved}`);
    // A search already kept is still returned.
    expect((await save(m, "q0")).status).toBe(200);
  });
});
