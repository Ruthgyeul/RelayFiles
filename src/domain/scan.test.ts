import { describe, expect, it } from "vitest";
import { parseClamdReply, permanentScanError, scanBlock } from "./scan";

describe("clamd replies", () => {
  it("reads clean, infected and error replies", () => {
    expect(parseClamdReply("stream: OK\0")).toEqual({ state: "clean" });
    expect(parseClamdReply("stream: Win.Test.EICAR_HDB-1 FOUND\0")).toEqual({ state: "infected", signature: "Win.Test.EICAR_HDB-1" });
    expect(parseClamdReply("INSTREAM size limit exceeded. ERROR\0")).toEqual({ state: "error", message: "INSTREAM size limit exceeded." });
    expect(parseClamdReply("")).toEqual({ state: "error", message: "no reply" });
    expect(parseClamdReply("garbage")).toEqual({ state: "error", message: "garbage" });
  });

  it("tells permanent errors from passing ones", () => {
    expect(permanentScanError("INSTREAM size limit exceeded.")).toBe(true);
    expect(permanentScanError("Can't allocate memory")).toBe(false);
  });

  it("keeps visitors away from files not known to be clean", () => {
    expect([scanBlock("NONE"), scanBlock("CLEAN"), scanBlock("PENDING"), scanBlock("FAILED")]).toEqual([null, null, "scanning", "blocked"]);
  });
});
