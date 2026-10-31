// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { sanitizedSvg } from "./svg-sanitize";

const bytes = (text: string) => new TextEncoder().encode(text) as Uint8Array<ArrayBuffer>;

describe("sanitizedSvg", () => {
  it("removes scripts, event handlers and javascript: links", async () => {
    const svg = await sanitizedSvg(
      bytes(
        '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script><a href="javascript:alert(3)"><rect width="10" height="10" onclick="alert(4)"/></a><foreignObject><iframe src="https://evil.example"/></foreignObject></svg>',
      ),
    );
    expect(svg).not.toMatch(/script|onload|onclick|javascript:|iframe|foreignObject/i);
    expect(svg).toContain("<rect");
  });

  it("keeps shapes, gradients and filters", async () => {
    const svg = await sanitizedSvg(
      bytes('<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g"><stop offset="0"/></linearGradient><filter id="f"><feGaussianBlur stdDeviation="2"/></filter></defs><circle r="4" fill="url(#g)" filter="url(#f)"/></svg>'),
    );
    for (const tag of ["linearGradient", "feGaussianBlur", "circle"]) expect(svg).toContain(tag);
  });

  it("stays a standalone SVG document an <img> can draw", async () => {
    const svg = await sanitizedSvg(bytes('<?xml version="1.0"?>\n<!DOCTYPE svg>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"><path d="M0 0h4"/></svg>'));
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('viewBox="0 0 4 4"');
  });
});
