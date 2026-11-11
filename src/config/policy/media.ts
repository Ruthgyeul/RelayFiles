/** Media processing, the viewer and child processes. Part of the product policy (src/config/policy.ts). */

export const MEDIA = {
  /** Retry-After for a shared photo whose metadata-stripped copy the worker has not made yet. */
  stripPendingRetrySec: 5,
  /** Longest side of generated thumbnails (2x the 288px list preview). */
  thumbSizePx: 576,
  thumbQuality: 72,
  /**
   * Viewer previews: images are shown as a WebP fitting this box (sharp on any screen up to
   * 2560 px) instead of the original; the original stays one click away (Download).
   */
  previewSizePx: 2560,
  /** High enough to look identical to the original at the preview size. */
  previewQuality: 92,
  /** Smaller originals already open fast, so they are shown as they are. */
  previewMinBytes: 512 * 1024,
  /** Types sharp rewrites for the preview (GIF is left as is: it may be animated). */
  previewTypes: ["image/jpeg", "image/png", "image/webp", "image/avif", "image/tiff"],
  /** Video thumbnails use the frame at this time (or the first frame of shorter clips). */
  videoFrameSeconds: 1,
  /** Images larger than this get no metadata-stripped copy (held in memory while stripping). */
  maxStripBytes: 200_000_000,
  /** Largest video the worker copies without its metadata for share links (the copy takes as much disk again). */
  maxVideoStripBytes: 20_000_000_000,
  /** Time allowed per GB of video for that copy (streams are copied, not re-encoded), on top of ffmpegTimeoutSec. */
  videoStripSecPerGb: 60,
  /** Largest image (in pixels) the thumbnailer decodes; stops decompression bombs. */
  maxInputPixels: 268_402_689,
  /** ffmpeg gives up after this long. */
  ffmpegTimeoutSec: 60,
  /**
   * What ffmpeg may open for an uploaded file: the file itself, and only container formats of
   * real videos. Playlists (HLS), concat lists and other formats that point at further files are
   * refused, so a crafted upload cannot make ffmpeg read (and the transcoder stream back) other
   * files on the server. Names are ffmpeg demuxers (`ffmpeg -demuxers`); "mov" covers MP4, M4V
   * and 3GP, "matroska" covers WebM.
   */
  ffmpegProtocols: ["file"],
  ffmpegDemuxers: ["mov", "matroska", "avi", "asf", "mpegts", "mpeg", "flv", "ogg", "wav", "mp3"],
  /** Largest PNG frame read back from ffmpeg (a 8K frame fits); more stops the command. */
  maxFrameBytes: 256 * 1024 * 1024,
  /** Largest metadata listing read back from ffmpeg (`-f ffmetadata`, for the date taken). */
  maxMetadataBytes: 1024 * 1024,
  /**
   * What the browser may keep (playback bytes, thumbnails, previews, converted video). A file's
   * bytes never change under its URL (a replaced file gets a new id), so they are `immutable`:
   * replays, seeks back and returning to an earlier video come from the browser's cache with
   * no request to the server. Downloads are never cached (limits and counts need each request).
   */
  cacheMaxAgeSec: 365 * 24 * 60 * 60,
  workerConcurrency: 2,
  /**
   * A job that fails for a reason outside the file (storage I/O error, volume offline, all
   * conversion slots busy, a timeout) is tried again with exponential backoff from jobBackoffMs:
   * 6 attempts span about five minutes, long enough to re-plug an SSD.
   */
  jobAttempts: 6,
  jobBackoffMs: 10_000,
} as const;

/** Cache-Control of responses whose bytes never change for their URL (see MEDIA.cacheMaxAgeSec). */
export const IMMUTABLE_CACHE = `private, max-age=${MEDIA.cacheMaxAgeSec}, immutable`;

/** The viewer's previews of files that are not media (text, code, tables, PDF, SVG, fonts, Word, Excel). */
export const DOCUMENT_PREVIEW = {
  /** Text files show at most this much from the start (one Range request, never the whole file). */
  textMaxBytes: 1024 * 1024,
  /** Longer text is shown without syntax colors (highlighting would hold up the page). */
  highlightMaxChars: 256 * 1024,
  /** Bytes checked for NUL characters to tell binary files from text. */
  sniffBytes: 8 * 1024,
  /** Rows of a table (CSV/TSV, a spreadsheet sheet) shown, not counting the header. */
  tableMaxRows: 1000,
  /** Columns of a table shown. */
  tableMaxColumns: 100,
  /** SVGs, fonts, Word and Excel files larger than this are not loaded for a preview (read whole). */
  assetMaxBytes: 20 * 1024 * 1024,
  /** PDF pages start rendering this far before they scroll into view. */
  pdfPreloadMarginPx: 800,
  /** Highest pixel ratio PDF pages are drawn at (sharp on 2x screens, bounded memory). */
  pdfMaxPixelRatio: 2,
  /** Width PDF pages are laid out at before the stage has been measured. */
  pdfFallbackWidthPx: 800,
} as const;

/** The media viewer's subtitles and slideshow. */
export const VIEWER = {
  /**
   * Subtitle files (.vtt/.srt next to a video) larger than this are not loaded. Same as the
   * text preview cap, so a share link's playback route serves them (`streamReach` for text).
   */
  subtitleMaxBytes: DOCUMENT_PREVIEW.textMaxBytes,
  /** How long each picture shows in a slideshow. */
  slideshowIntervalMs: 4_000,
} as const;

/**
 * Videos in containers browsers cannot play (AVI, WMV, MPEG-TS, ...) are converted while they
 * play: ffmpeg writes fragmented MP4 (H.264/AAC) that starts before the conversion ends.
 */
export const TRANSCODE = {
  /** Default for VIDEO_TRANSCODE_MAX: conversions running at once (CPU-heavy). */
  maxConcurrent: 2,
  /** Output height limit: 720p converts faster than real time on a small server. */
  maxHeightPx: 720,
  /** x264 speed/size trade-off and quality (lower CRF = better and larger). */
  preset: "veryfast",
  crf: 23,
  audioBitrate: "128k",
  /** One conversion stops after this much output (bounds a single request). */
  maxOutputBytes: 4 * 1024 * 1024 * 1024,
  /** Retry-After sent while every conversion slot is in use. */
  busyRetrySec: 10,
  /**
   * Conversions one requester (an account, or a link visitor's address) runs at once, so one
   * visitor cannot hold every VIDEO_TRANSCODE_MAX slot. Two, so seeking (the player drops the
   * old request as it opens the new one) is not refused while the old one winds down.
   */
  maxPerRequester: 2,
  /**
   * A conversion whose output nobody reads for this long is stopped: a paused or deliberately
   * slow reader would otherwise hold its slot through backpressure for as long as it likes.
   */
  idleTimeoutMs: 120_000,
  /** Longest a single live conversion runs, whatever is read (longer than any film at playback pace). */
  maxRunMs: 4 * 60 * 60 * 1000,
  /** How often a running conversion checks the two limits above. */
  watchIntervalMs: 10_000,
  /**
   * A conversion slot (shared by every app process through Redis) lapses this long after its
   * last renewal, so a crashed process frees its slots; running conversions renew every third of it.
   */
  slotLeaseMs: 60_000,
  /**
   * A video converted live this many times within cacheWindowSec is converted once by the
   * worker and played from that file afterwards (system/transcoded, not counted toward quotas).
   */
  cacheAfterPlays: 3,
  cacheWindowSec: 7 * 24 * 60 * 60,
  /** Stored conversions are deleted this long after they were made (popular ones are made again). */
  cacheKeepDays: 30,
  /**
   * A stored conversion (worker) is stopped after this long. 720p converts faster than real
   * time on the N95, so this covers videos up to about this length; a longer or hung one is
   * stopped (SIGTERM, then SIGKILL) and not retried until it is played often enough again.
   */
  storeTimeoutSec: 6 * 60 * 60,
} as const;

/** Child processes (ffmpeg, smartctl) started through runCommand. */
export const PROCESS = {
  /** After a timeout the child gets SIGTERM, then SIGKILL if it is still running this much later. */
  killGraceMs: 2_000,
  /** Output kept per stream unless the caller sets its own limit; more stops the command. */
  maxOutputBytes: 1024 * 1024,
  /** Error output kept for messages and logs (the rest is dropped, not buffered). */
  maxStderrBytes: 4_096,
} as const;
