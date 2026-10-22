import { describe, expect, it } from "vitest";
import { decodeText, lineCount, looksBinary, parseDelimited, prettyJson } from "./document";

const SNIFF = 8;
const utf8 = (text: string) => new TextEncoder().encode(text);

describe("looksBinary", () => {
  it("finds NUL bytes within the window", () => {
    expect(looksBinary(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00]), SNIFF)).toBe(true);
    expect(looksBinary(new Uint8Array([0x41, 0x41, 0x41, 0x41, 0x00]), 4)).toBe(false);
    expect(looksBinary(utf8("plain text"), SNIFF)).toBe(false);
  });

  it("accepts UTF-16 text, which is full of NUL bytes", () => {
    expect(looksBinary(new Uint8Array([0xff, 0xfe, 0x41, 0x00]), SNIFF)).toBe(false);
  });
});

describe("decodeText", () => {
  it("decodes UTF-8 and drops a byte-order mark", () => {
    expect(decodeText(utf8("﻿안녕 hello"), false, SNIFF)).toEqual({ text: "안녕 hello", encoding: "utf-8" });
  });

  it("drops a character cut in half at the end of a partial read", () => {
    const bytes = utf8("ab안");
    expect(decodeText(bytes.subarray(0, bytes.length - 1), true, SNIFF)?.text).toBe("ab");
  });

  it("decodes UTF-16 with a byte-order mark", () => {
    expect(decodeText(new Uint8Array([0xff, 0xfe, 0x68, 0x00, 0x69, 0x00]), false, SNIFF)).toEqual({ text: "hi", encoding: "utf-16le" });
    expect(decodeText(new Uint8Array([0xfe, 0xff, 0x00, 0x68, 0x00, 0x69]), false, SNIFF)).toEqual({ text: "hi", encoding: "utf-16be" });
  });

  it("falls back to EUC-KR for legacy Korean text", () => {
    // "한글" in EUC-KR
    expect(decodeText(new Uint8Array([0xc7, 0xd1, 0xb1, 0xdb]), false, SNIFF)).toEqual({ text: "한글", encoding: "euc-kr" });
  });

  it("returns null for binary content", () => {
    expect(decodeText(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00]), false, SNIFF)).toBeNull();
  });
});

describe("lineCount", () => {
  it("counts lines like an editor", () => {
    expect(lineCount("")).toBe(0);
    expect(lineCount("one")).toBe(1);
    expect(lineCount("one\ntwo\n")).toBe(2);
    expect(lineCount("one\n\nthree")).toBe(3);
  });
});

describe("parseDelimited", () => {
  it("splits rows and cells, with quoted commas, quotes and newlines", () => {
    const table = parseDelimited('name,note\r\n"Lee, J","said ""hi""\nthen left"\nKim\n', ",", 10);
    expect(table).toEqual({ rows: [["name", "note"], ["Lee, J", 'said "hi"\nthen left'], ["Kim"]], columns: 2, truncated: false });
  });

  it("reads tab-separated text", () => {
    expect(parseDelimited("a\tb\n1\t2", "\t", 10).rows).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("stops after the row limit", () => {
    expect(parseDelimited("1\n2\n3\n", ",", 2)).toEqual({ rows: [["1"], ["2"]], columns: 1, truncated: true });
    expect(parseDelimited("1\n2\n", ",", 2).truncated).toBe(false);
  });
});

describe("prettyJson", () => {
  it("lays out one-line JSON", () => {
    expect(prettyJson('{"a":[1,2]}')).toBe('{\n  "a": [\n    1,\n    2\n  ]\n}\n');
  });

  it("leaves multi-line or invalid JSON alone", () => {
    expect(prettyJson('{\n"a": 1}')).toBeNull();
    expect(prettyJson("{not json}")).toBeNull();
    expect(prettyJson("")).toBeNull();
  });
});
