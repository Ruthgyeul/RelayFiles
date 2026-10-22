/**
 * File formats by name: the icon a file gets in lists and how the viewer previews files that
 * are not images, videos or audio (text, code, Markdown, tables, PDF, SVG, fonts, Word, Excel).
 */
import type { NodeKind } from "./tree";

/** How the viewer shows a non-media file. */
export type DocumentPreview = "text" | "code" | "markdown" | "table" | "pdf" | "svg" | "font" | "docx" | "spreadsheet";

/** Icon families; the UI maps each to an icon and a color. */
export const FORMAT_ICONS = [
  "generic", "text", "markdown", "code", "terminal", "json", "config", "html", "css", "js", "jsx", "ts", "tsx",
  "python", "sql", "c", "cpp", "csharp", "rust", "vue", "table", "pdf", "svg", "font", "archive", "doc",
  "sheet", "slides", "disc", "package", "certificate", "database", "book", "model", "lock",
] as const;
export type FormatIcon = (typeof FORMAT_ICONS)[number];

export interface FileFormat {
  /** Short name shown in the viewer ("TypeScript", "PDF"). */
  label: string;
  icon: FormatIcon;
  /** How the viewer shows it; null = no preview (download only). */
  preview: DocumentPreview | null;
  /** highlight.js language of a code preview (none = plain text). */
  language?: string;
  /** Cell separator of a table preview. */
  delimiter?: "," | "\t";
  /** Unknown type: the viewer checks the first bytes and only shows it when they are text. */
  sniff?: true;
}

const code = (label: string, language: string | undefined, icon: FormatIcon = "code"): FileFormat => ({ label, icon, preview: "code", ...(language ? { language } : {}) });
const text = (label: string, icon: FormatIcon = "text"): FileFormat => ({ label, icon, preview: "text" });
const binary = (label: string, icon: FormatIcon): FileFormat => ({ label, icon, preview: null });

const SHELL = code("Shell", "bash", "terminal");
const ENV = code("Environment", "ini", "config");
const IGNORE = code("Ignore list", "bash", "config");
const MAKEFILE = code("Makefile", "makefile", "terminal");
const DOCKERFILE = code("Dockerfile", "dockerfile", "config");
const RUBY = code("Ruby", "ruby");

/** Formats by extension. Several extensions share one entry (the spread lists below). */
const BY_EXTENSION: Record<string, FileFormat> = {
  // Text and documents with a rendered preview
  txt: text("Text"),
  text: text("Text"),
  log: text("Log"),
  out: text("Output"),
  nfo: text("Info"),
  srt: text("Subtitles"),
  vtt: text("Subtitles"),
  rst: text("reStructuredText", "markdown"),
  md: { label: "Markdown", icon: "markdown", preview: "markdown" },
  markdown: { label: "Markdown", icon: "markdown", preview: "markdown" },
  mdx: { label: "MDX", icon: "markdown", preview: "markdown" },
  csv: { label: "CSV", icon: "table", preview: "table", delimiter: "," },
  tsv: { label: "TSV", icon: "table", preview: "table", delimiter: "\t" },
  pdf: { label: "PDF", icon: "pdf", preview: "pdf" },
  svg: { label: "SVG", icon: "svg", preview: "svg" },
  ...Object.fromEntries(["ttf", "otf", "woff", "woff2"].map((ext) => [ext, { label: `Font (${ext.toUpperCase()})`, icon: "font", preview: "font" } satisfies FileFormat])),

  // Data and configuration
  json: code("JSON", "json", "json"),
  jsonc: code("JSON", "json", "json"),
  json5: code("JSON5", "json", "json"),
  geojson: code("GeoJSON", "json", "json"),
  webmanifest: code("Web manifest", "json", "json"),
  ipynb: code("Jupyter notebook", "json", "json"),
  gltf: code("glTF", "json", "model"),
  yaml: code("YAML", "yaml", "config"),
  yml: code("YAML", "yaml", "config"),
  toml: code("TOML", "ini", "config"),
  ini: code("INI", "ini", "config"),
  cfg: code("Config", "ini", "config"),
  conf: code("Config", "ini", "config"),
  properties: code("Properties", "properties", "config"),
  env: ENV,
  lock: text("Lock file", "lock"),
  xml: code("XML", "xml", "code"),
  xsd: code("XML schema", "xml", "code"),
  xsl: code("XSLT", "xml", "code"),
  xslt: code("XSLT", "xml", "code"),
  plist: code("Property list", "xml", "config"),

  // Web
  html: code("HTML", "xml", "html"),
  htm: code("HTML", "xml", "html"),
  xhtml: code("XHTML", "xml", "html"),
  css: code("CSS", "css", "css"),
  scss: code("SCSS", "scss", "css"),
  sass: code("Sass", "scss", "css"),
  less: code("Less", "less", "css"),
  styl: code("Stylus", "stylus", "css"),
  js: code("JavaScript", "javascript", "js"),
  mjs: code("JavaScript", "javascript", "js"),
  cjs: code("JavaScript", "javascript", "js"),
  jsx: code("JSX", "javascript", "jsx"),
  ts: code("TypeScript", "typescript", "ts"),
  mts: code("TypeScript", "typescript", "ts"),
  cts: code("TypeScript", "typescript", "ts"),
  tsx: code("TSX", "typescript", "tsx"),
  vue: code("Vue", "xml", "vue"),
  svelte: code("Svelte", "xml"),
  astro: code("Astro", "xml"),
  graphql: code("GraphQL", "graphql"),
  gql: code("GraphQL", "graphql"),
  http: code("HTTP", "http"),
  coffee: code("CoffeeScript", "coffeescript"),

  // Shell and scripts
  sh: SHELL,
  bash: SHELL,
  zsh: SHELL,
  ksh: SHELL,
  fish: code("Fish", "bash", "terminal"),
  ps1: code("PowerShell", "powershell", "terminal"),
  psm1: code("PowerShell", "powershell", "terminal"),
  bat: code("Batch", "dos", "terminal"),
  cmd: code("Batch", "dos", "terminal"),
  awk: code("AWK", "awk", "terminal"),
  vim: code("Vim script", "vim"),
  mk: MAKEFILE,
  cmake: code("CMake", "cmake", "terminal"),
  dockerfile: DOCKERFILE,
  nix: code("Nix", "nix", "config"),
  tf: code("Terraform", undefined, "config"),
  hcl: code("HCL", undefined, "config"),

  // Programming languages
  py: code("Python", "python", "python"),
  pyw: code("Python", "python", "python"),
  pyi: code("Python stub", "python", "python"),
  rb: RUBY,
  php: code("PHP", "php"),
  java: code("Java", "java"),
  kt: code("Kotlin", "kotlin"),
  kts: code("Kotlin script", "kotlin"),
  scala: code("Scala", "scala"),
  groovy: code("Groovy", "groovy"),
  gradle: code("Gradle", "gradle"),
  go: code("Go", "go"),
  rs: code("Rust", "rust", "rust"),
  c: code("C", "c", "c"),
  h: code("C header", "c", "c"),
  cpp: code("C++", "cpp", "cpp"),
  cc: code("C++", "cpp", "cpp"),
  cxx: code("C++", "cpp", "cpp"),
  hpp: code("C++ header", "cpp", "cpp"),
  hh: code("C++ header", "cpp", "cpp"),
  ino: code("Arduino", "arduino", "cpp"),
  cs: code("C#", "csharp", "csharp"),
  m: code("Objective-C", "objectivec"),
  mm: code("Objective-C++", "objectivec"),
  swift: code("Swift", "swift"),
  dart: code("Dart", "dart"),
  lua: code("Lua", "lua"),
  pl: code("Perl", "perl"),
  pm: code("Perl", "perl"),
  r: code("R", "r"),
  jl: code("Julia", "julia"),
  ex: code("Elixir", "elixir"),
  exs: code("Elixir", "elixir"),
  erl: code("Erlang", "erlang"),
  hs: code("Haskell", "haskell"),
  clj: code("Clojure", "clojure"),
  cljs: code("ClojureScript", "clojure"),
  edn: code("EDN", "clojure"),
  fs: code("F#", "fsharp"),
  fsx: code("F#", "fsharp"),
  ml: code("OCaml", "ocaml"),
  nim: code("Nim", "nim"),
  zig: code("Zig", undefined),
  cr: code("Crystal", "crystal"),
  elm: code("Elm", "elm"),
  d: code("D", "d"),
  pas: code("Pascal", "delphi"),
  f90: code("Fortran", "fortran"),
  f95: code("Fortran", "fortran"),
  ada: code("Ada", "ada"),
  adb: code("Ada", "ada"),
  tcl: code("Tcl", "tcl"),
  sol: code("Solidity", "solidity"),
  sql: code("SQL", "sql", "sql"),
  proto: code("Protocol Buffers", "protobuf"),
  asm: code("Assembly", "x86asm"),
  s: code("Assembly", "x86asm"),
  wat: code("WebAssembly text", "wasm"),
  glsl: code("GLSL", "glsl"),
  vert: code("GLSL", "glsl"),
  frag: code("GLSL", "glsl"),
  v: code("Verilog", "verilog"),
  sv: code("SystemVerilog", "verilog"),
  vhd: code("VHDL", "vhdl"),
  vhdl: code("VHDL", "vhdl"),
  tex: code("LaTeX", "latex"),
  sty: code("LaTeX", "latex"),
  bib: code("BibTeX", "latex"),
  adoc: code("AsciiDoc", "asciidoc", "markdown"),
  diff: code("Diff", "diff"),
  patch: code("Patch", "diff"),

  // Keys and certificates (text when PEM; binary ones get no preview after the check)
  pem: text("PEM", "certificate"),
  crt: text("Certificate", "certificate"),
  cer: text("Certificate", "certificate"),
  csr: text("Certificate request", "certificate"),
  pub: text("Public key", "certificate"),
  asc: text("PGP armored", "certificate"),
  key: { label: "Key", icon: "certificate", preview: "text", sniff: true },

  // No preview: icon only
  ...Object.fromEntries(["zip", "tar", "gz", "tgz", "bz2", "xz", "zst", "7z", "rar", "lz", "lzma", "cab", "z"].map((ext) => [ext, binary("Archive", "archive")])),
  docx: { label: "Word document", icon: "doc", preview: "docx" },
  xlsx: { label: "Excel workbook", icon: "sheet", preview: "spreadsheet" },
  xlsm: { label: "Excel workbook", icon: "sheet", preview: "spreadsheet" },
  ...Object.fromEntries(["doc", "odt", "rtf", "pages", "hwp", "hwpx"].map((ext) => [ext, binary("Document", "doc")])),
  ...Object.fromEntries(["xls", "ods", "numbers"].map((ext) => [ext, binary("Spreadsheet", "sheet")])),
  ...Object.fromEntries(["ppt", "pptx", "odp"].map((ext) => [ext, binary("Presentation", "slides")])),
  ...Object.fromEntries(["iso", "dmg", "img", "vhdx", "vmdk", "qcow2"].map((ext) => [ext, binary("Disk image", "disc")])),
  ...Object.fromEntries(["exe", "msi", "deb", "rpm", "apk", "aab", "ipa", "appimage", "pkg", "jar", "war", "whl", "snap", "flatpak"].map((ext) => [ext, binary("Package", "package")])),
  ...Object.fromEntries(["p12", "pfx", "der", "jks", "gpg", "kdbx"].map((ext) => [ext, binary("Key store", "certificate")])),
  ...Object.fromEntries(["db", "sqlite", "sqlite3", "mdb", "accdb", "parquet"].map((ext) => [ext, binary("Database", "database")])),
  ...Object.fromEntries(["epub", "mobi", "azw3"].map((ext) => [ext, binary("E-book", "book")])),
  ...Object.fromEntries(["stl", "obj", "fbx", "glb", "blend", "3mf", "step", "stp"].map((ext) => [ext, binary("3D model", "model")])),
};

/** Files known by their whole name (no extension, or one that would mislead). */
const BY_NAME: Record<string, FileFormat> = {
  dockerfile: DOCKERFILE,
  containerfile: DOCKERFILE,
  makefile: MAKEFILE,
  gnumakefile: MAKEFILE,
  "cmakelists.txt": code("CMake", "cmake", "terminal"),
  jenkinsfile: code("Jenkinsfile", "groovy"),
  vagrantfile: RUBY,
  gemfile: RUBY,
  rakefile: RUBY,
  podfile: RUBY,
  procfile: text("Procfile"),
  caddyfile: code("Caddyfile", undefined, "config"),
  "nginx.conf": code("Nginx config", "nginx", "config"),
  license: text("License"),
  licence: text("License"),
  copying: text("License"),
  notice: text("Notice"),
  authors: text("Authors"),
  changelog: text("Changelog"),
  readme: text("Readme"),
  todo: text("To-do"),
  ".gitignore": IGNORE,
  ".gitattributes": IGNORE,
  ".gitmodules": code("Git config", "ini", "config"),
  ".gitconfig": code("Git config", "ini", "config"),
  ".dockerignore": IGNORE,
  ".npmignore": IGNORE,
  ".prettierignore": IGNORE,
  ".eslintignore": IGNORE,
  ".editorconfig": code("EditorConfig", "ini", "config"),
  ".npmrc": code("npm config", "ini", "config"),
  ".yarnrc": code("Yarn config", "yaml", "config"),
  ".nvmrc": text("Node version", "config"),
  ".node-version": text("Node version", "config"),
  ".python-version": text("Python version", "config"),
  ".bashrc": SHELL,
  ".bash_profile": SHELL,
  ".bash_aliases": SHELL,
  ".zshrc": SHELL,
  ".zprofile": SHELL,
  ".profile": SHELL,
  ".htaccess": code("Apache config", "apache", "config"),
};

/** Anything else: shown as text when its first bytes are text, else "no preview". */
const UNKNOWN: FileFormat = { label: "File", icon: "generic", preview: "text", sniff: true };

/** Every format this module knows (tests check that each code language can be highlighted). */
export const KNOWN_FORMATS: readonly FileFormat[] = [...Object.values(BY_EXTENSION), ...Object.values(BY_NAME), ENV, UNKNOWN];

/** Lowercase extension without the dot ("" for none; dotfiles like ".bashrc" have none). */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** The format of a file by its name. */
export function fileFormatOf(name: string): FileFormat {
  const lower = name.toLowerCase();
  const known = BY_NAME[lower] ?? (lower.startsWith(".env") ? ENV : undefined);
  return known ?? BY_EXTENSION[extensionOf(lower)] ?? UNKNOWN;
}

/**
 * The viewer's document preview of a file, or null when it is media (images, videos and
 * audio have their own players; SVG images are the exception, shown from their source).
 */
export function documentPreviewOf(name: string, kind: NodeKind | null): FileFormat | null {
  if (kind === "video" || kind === "audio") return null;
  const format = fileFormatOf(name);
  if (kind === "image") return format.preview === "svg" ? format : null;
  return format;
}
