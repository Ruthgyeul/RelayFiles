import { describe, expect, it } from "vitest";
import { KNOWN_FORMATS } from "@/domain/file-format";
import { highlight, highlighterFor } from "./highlight";

describe("highlight", () => {
  it("can highlight every language a file format names", async () => {
    const languages = new Set(KNOWN_FORMATS.flatMap((format) => (format.language ? [format.language] : [])));
    for (const language of languages) expect(await highlighterFor(language), language).not.toBeNull();
  });

  it("escapes the text it highlights", async () => {
    const html = await highlight('const tag = "<script>alert(1)</script>";', "javascript");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("highlights Solidity", async () => {
    expect(await highlight("contract Vault { uint256 total; }", "solidity")).toContain('<span class="hljs-keyword">contract</span>');
  });

  it("has nothing for unknown languages", async () => {
    expect(await highlight("x", "no-such-language")).toBeNull();
  });
});
