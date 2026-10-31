import { describe, expect, it } from "vitest";
import { gauge, renderPrometheus } from "./prometheus";

describe("renderPrometheus", () => {
  it("writes HELP, TYPE and samples with labels", () => {
    const text = renderPrometheus([
      gauge("relayfiles_accounts", "Accounts on this server.", 3),
      { name: "relayfiles_media_queue_jobs", help: "Media jobs by state.", type: "gauge", samples: [{ labels: { state: "waiting" }, value: 2 }, { labels: { state: "active" }, value: 1 }] },
      { name: "relayfiles_transcodes_started_total", help: "Conversions started.", type: "counter", samples: [{ value: 7 }] },
    ]);
    expect(text).toBe(
      [
        "# HELP relayfiles_accounts Accounts on this server.",
        "# TYPE relayfiles_accounts gauge",
        "relayfiles_accounts 3",
        "# HELP relayfiles_media_queue_jobs Media jobs by state.",
        "# TYPE relayfiles_media_queue_jobs gauge",
        'relayfiles_media_queue_jobs{state="waiting"} 2',
        'relayfiles_media_queue_jobs{state="active"} 1',
        "# HELP relayfiles_transcodes_started_total Conversions started.",
        "# TYPE relayfiles_transcodes_started_total counter",
        "relayfiles_transcodes_started_total 7",
        "",
      ].join("\n"),
    );
  });

  it("escapes label values and help text, and writes special numbers", () => {
    const text = renderPrometheus([{ name: "m", help: "a\\b\nc", type: "gauge", samples: [{ labels: { service: 'say "hi"\\\n' }, value: Infinity }, { value: NaN }] }]);
    expect(text).toContain("# HELP m a\\\\b\\nc");
    expect(text).toContain('m{service="say \\"hi\\"\\\\\\n"} +Inf');
    expect(text).toContain("m NaN");
  });

  it("leaves out families without samples and refuses invalid names", () => {
    expect(renderPrometheus([gauge("relayfiles_storage_used_bytes", "Used.", null)])).toBe("");
    expect(() => renderPrometheus([gauge("bad-name", "x", 1)])).toThrow(RangeError);
    expect(() => renderPrometheus([{ name: "m", help: "x", type: "gauge", samples: [{ labels: { "bad-label": "x" }, value: 1 }] }])).toThrow(RangeError);
  });
});
