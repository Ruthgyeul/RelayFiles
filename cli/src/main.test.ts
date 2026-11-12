import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sharePatchOf } from "./main.ts";

describe("sharePatchOf", () => {
  const none = { folder: "root", replace: false, remove: false };

  it("is null without share options", () => {
    assert.equal(sharePatchOf(none), null);
  });

  it("maps the options to the settings they change", () => {
    assert.deepEqual(sharePatchOf({ ...none, public: true, password: "pw", limit: "3", note: "hi" }), { visibility: "public", password: "pw", downloadLimit: 3, note: "hi" });
    assert.deepEqual(sharePatchOf({ ...none, private: true, "no-password": true, "no-limit": true }), { visibility: "private", password: null, downloadLimit: null });
  });

  it("refuses a limit that is not a whole number above 0", () => {
    assert.throws(() => sharePatchOf({ ...none, limit: "0" }), /--limit/);
    assert.throws(() => sharePatchOf({ ...none, limit: "2.5" }), /--limit/);
  });
});
