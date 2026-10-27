/**
 * Script, event handlers and external references removed from an SVG. An <img> never runs
 * them, but a blob URL is a document of the app's origin: "Open image in new tab" would.
 */
export async function sanitizedSvg(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const { default: DOMPurify } = await import("dompurify");
  return DOMPurify.sanitize(new TextDecoder().decode(bytes), { USE_PROFILES: { svg: true, svgFilters: true } });
}
