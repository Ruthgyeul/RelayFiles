import { describe, expect, it } from "vitest";
import { documentPreviewOf, extensionOf, fileFormatOf, FORMAT_ICONS } from "./file-format";

describe("extensionOf", () => {
  it("returns the lowercase extension", () => {
    expect(extensionOf("Report.PDF")).toBe("pdf");
    expect(extensionOf("backup.tar.gz")).toBe("gz");
  });

  it("has none for names without one and for dotfiles", () => {
    expect(extensionOf("Makefile")).toBe("");
    expect(extensionOf(".bashrc")).toBe("");
  });
});

describe("fileFormatOf", () => {
  it("previews code with its language", () => {
    expect(fileFormatOf("deploy.sh")).toMatchObject({ preview: "code", language: "bash", icon: "terminal" });
    expect(fileFormatOf("app.tsx")).toMatchObject({ preview: "code", language: "typescript", icon: "tsx" });
    expect(fileFormatOf("Vault.sol")).toMatchObject({ preview: "code", language: "solidity" });
    expect(fileFormatOf("main.zig")).toEqual({ label: "Zig", icon: "code", preview: "code" });
  });

  it("renders Markdown, tables, PDF, SVG and fonts", () => {
    expect(fileFormatOf("README.md").preview).toBe("markdown");
    expect(fileFormatOf("data.csv")).toMatchObject({ preview: "table", delimiter: "," });
    expect(fileFormatOf("data.tsv")).toMatchObject({ preview: "table", delimiter: "\t" });
    expect(fileFormatOf("paper.pdf").preview).toBe("pdf");
    expect(fileFormatOf("logo.svg").preview).toBe("svg");
    expect(fileFormatOf("Inter.woff2")).toMatchObject({ preview: "font", label: "Font (WOFF2)" });
    expect(fileFormatOf("Report.DOCX")).toEqual({ label: "Word document", icon: "doc", preview: "docx" });
    expect(fileFormatOf("budget.xlsx")).toEqual({ label: "Excel workbook", icon: "sheet", preview: "spreadsheet" });
    expect(fileFormatOf("macros.xlsm").preview).toBe("spreadsheet");
  });

  it("knows files by their whole name", () => {
    expect(fileFormatOf("Dockerfile")).toMatchObject({ language: "dockerfile" });
    expect(fileFormatOf("Makefile")).toMatchObject({ language: "makefile" });
    expect(fileFormatOf(".gitignore")).toMatchObject({ preview: "code", icon: "config" });
    expect(fileFormatOf(".env.production")).toMatchObject({ language: "ini", icon: "config" });
    expect(fileFormatOf("LICENSE").preview).toBe("text");
  });

  it("gives binary formats an icon and no preview", () => {
    expect(fileFormatOf("photos.zip")).toEqual({ label: "Archive", icon: "archive", preview: null });
    expect(fileFormatOf("report.doc")).toEqual({ label: "Document", icon: "doc", preview: null });
    expect(fileFormatOf("budget.xls")).toEqual({ label: "Spreadsheet", icon: "sheet", preview: null });
    expect(fileFormatOf("deck.pptx").icon).toBe("slides");
    expect(fileFormatOf("ubuntu.iso").icon).toBe("disc");
    expect(fileFormatOf("setup.exe").icon).toBe("package");
  });

  it("checks unknown files for text before showing them", () => {
    expect(fileFormatOf("notes")).toEqual({ label: "File", icon: "generic", preview: "text", sniff: true });
    expect(fileFormatOf("dump.xyz").sniff).toBe(true);
  });

  it("only uses known icon families", () => {
    const names = ["a.txt", "a.md", "a.json", "a.yml", "a.html", "a.css", "a.js", "a.py", "a.sql", "a.c", "a.cpp", "a.cs", "a.rs", "a.vue", "a.pem", "a.db", "a.epub", "a.stl", "a.lock"];
    for (const name of names) expect(FORMAT_ICONS, name).toContain(fileFormatOf(name).icon);
  });
});

describe("documentPreviewOf", () => {
  it("leaves videos, audio and pictures to the media players", () => {
    expect(documentPreviewOf("clip.ts", "video")).toBeNull();
    expect(documentPreviewOf("song.mp3", "audio")).toBeNull();
    expect(documentPreviewOf("photo.jpg", "image")).toBeNull();
  });

  it("shows SVG images and other files as documents", () => {
    expect(documentPreviewOf("logo.svg", "image")?.preview).toBe("svg");
    expect(documentPreviewOf("index.ts", "other")?.language).toBe("typescript");
    expect(documentPreviewOf("notes.txt", null)?.preview).toBe("text");
  });
});
