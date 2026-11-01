import { describe, expect, it } from "vitest";
import { isSubtitleName, srtToVtt, subtitlesFor, toWebVtt } from "./subtitles";

describe("isSubtitleName", () => {
  it("knows .vtt and .srt", () => {
    expect(isSubtitleName("a.VTT")).toBe(true);
    expect(isSubtitleName("a.en.srt")).toBe(true);
    expect(isSubtitleName("a.ass")).toBe(false);
  });
});

describe("subtitlesFor", () => {
  const siblings = ["movie.mp4", "movie.vtt", "movie.en.srt", "Movie.KO.vtt", "movie.forced.srt", "other.srt", "trailer.en.vtt"];

  it("finds untagged and tagged files with the video's base name", () => {
    expect(subtitlesFor("movie.mp4", siblings)).toEqual([
      { name: "movie.vtt", format: "vtt", lang: null, label: "Subtitles" },
      { name: "movie.en.srt", format: "srt", lang: "en", label: "English" },
      { name: "movie.forced.srt", format: "srt", lang: null, label: "forced" },
      { name: "Movie.KO.vtt", format: "vtt", lang: "KO", label: "Korean" },
    ]);
  });

  it("also matches the video's full name", () => {
    expect(subtitlesFor("clip.mp4", ["clip.mp4.srt", "clip.mp4.de.vtt"]).map((entry) => [entry.name, entry.label])).toEqual([
      ["clip.mp4.srt", "Subtitles"],
      ["clip.mp4.de.vtt", "German"],
    ]);
  });

  it("tells same-label files apart by format", () => {
    expect(subtitlesFor("clip.mkv", ["clip.srt", "clip.vtt"]).map((entry) => entry.label)).toEqual(["Subtitles (SRT)", "Subtitles (VTT)"]);
  });

  it("treats unknown short tags as plain labels", () => {
    expect(subtitlesFor("a.mp4", ["a.xx.srt"])).toEqual([{ name: "a.xx.srt", format: "srt", lang: null, label: "xx" }]);
  });

  it("finds nothing for a video without subtitles", () => {
    expect(subtitlesFor("trailer.mp4", ["movie.vtt", "trailer.mp4"])).toEqual([]);
  });
});

describe("srtToVtt", () => {
  it("converts numbered SubRip blocks to WebVTT cues", () => {
    const srt = "﻿1\r\n00:00:01,000 --> 00:00:02,500\r\nHello\r\nworld\r\n\r\n2\r\n0:00:03,5 --> 0:00:04,25 X1:10 X2:20\r\n<i>Bye</i>\r\n";
    expect(srtToVtt(srt)).toBe("WEBVTT\n\n00:00:01.000 --> 00:00:02.500\nHello\nworld\n\n00:00:03.500 --> 00:00:04.250\n<i>Bye</i>\n");
  });

  it("drops blocks without timing and SubRip font tags, and escapes markup", () => {
    const srt = "garbage\n\n3\n00:01:00,000 --> 00:01:01,000\n<font color=\"#fff\">A & B < C</font> &amp; -->\n\n\n";
    expect(srtToVtt(srt)).toBe("WEBVTT\n\n00:01:00.000 --> 00:01:01.000\nA &amp; B &lt; C &amp; --&gt;\n");
  });

  it("keeps a header for an empty file", () => {
    expect(srtToVtt("")).toBe("WEBVTT\n\n\n");
  });
});

describe("toWebVtt", () => {
  it("passes WebVTT through and adds a missing header", () => {
    expect(toWebVtt("﻿WEBVTT\n\n00:01.000 --> 00:02.000\nHi\n", "vtt")).toBe("WEBVTT\n\n00:01.000 --> 00:02.000\nHi\n");
    expect(toWebVtt("WEBVTT - title\n", "vtt")).toBe("WEBVTT - title\n");
    expect(toWebVtt("00:01.000 --> 00:02.000\nHi\n", "vtt")).toBe("WEBVTT\n\n00:01.000 --> 00:02.000\nHi\n");
  });

  it("converts SubRip", () => {
    expect(toWebVtt("1\n00:00:01,000 --> 00:00:02,000\nHi\n", "srt")).toBe("WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHi\n");
  });
});
