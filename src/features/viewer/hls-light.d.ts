// hls.js ships types for its full build only; the light build (no alternate audio, subtitles or
// DRM, which conversions never have) has the same API.
declare module "hls.js/light" {
  export * from "hls.js";
  export { default } from "hls.js";
}
