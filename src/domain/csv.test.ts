import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "./csv";

describe("csvCell", () => {
  it("leaves plain text and numbers alone", () => {
    expect(csvCell("movie.mp4")).toBe("movie.mp4");
    expect(csvCell(42)).toBe("42");
    expect(csvCell(-3)).toBe("-3");
  });

  it("quotes commas, quotes and line breaks", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("one\ntwo")).toBe('"one\ntwo"');
    expect(csvCell("one\r\ntwo")).toBe('"one\r\ntwo"');
  });

  it("keeps text that starts like a formula from running", () => {
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell("+cmd")).toBe("'+cmd");
    expect(csvCell("-2")).toBe("'-2");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("\t=1")).toBe("'\t=1");
    expect(csvCell('=HYPERLINK("x","y")')).toBe(`"'=HYPERLINK(""x"",""y"")"`);
    expect(csvCell("a=b")).toBe("a=b");
  });
});

describe("toCsv", () => {
  it("joins rows with CRLF", () => {
    expect(toCsv([["kind", "file"], ["open", "a,b"]])).toBe('kind,file\r\nopen,"a,b"\r\n');
  });
});
