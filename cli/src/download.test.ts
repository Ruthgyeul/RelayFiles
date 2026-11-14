import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileNameOf, resumeRange } from "./download.ts";

describe("fileNameOf", () => {
  it("prefers the UTF-8 name", () => {
    assert.equal(fileNameOf("attachment; filename=\"a.txt\"; filename*=UTF-8''%EC%9E%AC%EC%95%84.txt"), "재아.txt");
    assert.equal(fileNameOf('attachment; filename="report.pdf"'), "report.pdf");
  });

  it("is null without a usable name", () => {
    assert.equal(fileNameOf(null), null);
    assert.equal(fileNameOf("attachment"), null);
    assert.equal(fileNameOf("attachment; filename*=UTF-8''%E0%A4%A"), null);
  });

  it("refuses names that would leave the current folder", () => {
    assert.equal(fileNameOf("attachment; filename*=UTF-8''..%2F..%2F.bashrc"), null);
    assert.equal(fileNameOf("attachment; filename*=UTF-8''%2Fetc%2Fpasswd"), null);
    assert.equal(fileNameOf('attachment; filename="..\\evil.txt"'), null);
    assert.equal(fileNameOf('attachment; filename=".."'), null);
    assert.equal(fileNameOf("attachment; filename*=UTF-8''a%00b"), null);
  });
});

describe("resumeRange", () => {
  it("asks for the rest after the bytes already there", () => {
    assert.equal(resumeRange(0), null);
    assert.equal(resumeRange(1024), "bytes=1024-");
  });
});
