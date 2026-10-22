import type { HLJSApi, LanguageFn } from "highlight.js";
import { solidity } from "./solidity";

type LanguageModule = Promise<{ default: LanguageFn }>;

/**
 * Languages outside highlight.js's common bundle that file-format.ts names, loaded only when a
 * file in that language is opened.
 */
const EXTRA_LANGUAGES: Record<string, () => LanguageModule> = {
  ada: () => import("highlight.js/lib/languages/ada"),
  apache: () => import("highlight.js/lib/languages/apache"),
  arduino: () => import("highlight.js/lib/languages/arduino"),
  asciidoc: () => import("highlight.js/lib/languages/asciidoc"),
  awk: () => import("highlight.js/lib/languages/awk"),
  clojure: () => import("highlight.js/lib/languages/clojure"),
  cmake: () => import("highlight.js/lib/languages/cmake"),
  coffeescript: () => import("highlight.js/lib/languages/coffeescript"),
  crystal: () => import("highlight.js/lib/languages/crystal"),
  d: () => import("highlight.js/lib/languages/d"),
  dart: () => import("highlight.js/lib/languages/dart"),
  delphi: () => import("highlight.js/lib/languages/delphi"),
  dockerfile: () => import("highlight.js/lib/languages/dockerfile"),
  dos: () => import("highlight.js/lib/languages/dos"),
  elixir: () => import("highlight.js/lib/languages/elixir"),
  elm: () => import("highlight.js/lib/languages/elm"),
  erlang: () => import("highlight.js/lib/languages/erlang"),
  fortran: () => import("highlight.js/lib/languages/fortran"),
  fsharp: () => import("highlight.js/lib/languages/fsharp"),
  glsl: () => import("highlight.js/lib/languages/glsl"),
  gradle: () => import("highlight.js/lib/languages/gradle"),
  groovy: () => import("highlight.js/lib/languages/groovy"),
  haskell: () => import("highlight.js/lib/languages/haskell"),
  http: () => import("highlight.js/lib/languages/http"),
  julia: () => import("highlight.js/lib/languages/julia"),
  latex: () => import("highlight.js/lib/languages/latex"),
  nginx: () => import("highlight.js/lib/languages/nginx"),
  nim: () => import("highlight.js/lib/languages/nim"),
  nix: () => import("highlight.js/lib/languages/nix"),
  ocaml: () => import("highlight.js/lib/languages/ocaml"),
  powershell: () => import("highlight.js/lib/languages/powershell"),
  properties: () => import("highlight.js/lib/languages/properties"),
  protobuf: () => import("highlight.js/lib/languages/protobuf"),
  scala: () => import("highlight.js/lib/languages/scala"),
  solidity: async () => ({ default: solidity }),
  stylus: () => import("highlight.js/lib/languages/stylus"),
  tcl: () => import("highlight.js/lib/languages/tcl"),
  verilog: () => import("highlight.js/lib/languages/verilog"),
  vhdl: () => import("highlight.js/lib/languages/vhdl"),
  vim: () => import("highlight.js/lib/languages/vim"),
  x86asm: () => import("highlight.js/lib/languages/x86asm"),
};

let core: Promise<HLJSApi> | null = null;

/** highlight.js with its common languages, loaded on first use (kept out of the page bundle). */
function loadCore(): Promise<HLJSApi> {
  core ??= import("highlight.js/lib/common").then((module) => module.default);
  return core;
}

/** highlight.js ready for `language` (a name or alias), or null when it has no such language. */
export async function highlighterFor(language: string): Promise<HLJSApi | null> {
  const hljs = await loadCore();
  if (hljs.getLanguage(language)) return hljs;
  const load = Object.hasOwn(EXTRA_LANGUAGES, language) ? EXTRA_LANGUAGES[language] : undefined;
  if (!load) return null;
  hljs.registerLanguage(language, (await load()).default);
  return hljs;
}

/**
 * Highlighted HTML of `text` (highlight.js escapes the text, so the markup holds only its own
 * spans), or null when the language is unknown.
 */
export async function highlight(text: string, language: string): Promise<string | null> {
  const hljs = await highlighterFor(language);
  return hljs ? hljs.highlight(text, { language, ignoreIllegals: true }).value : null;
}
