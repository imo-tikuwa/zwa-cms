import { createLowlight } from "lowlight";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import go from "highlight.js/lib/languages/go";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import lua from "highlight.js/lib/languages/lua";
import markdown from "highlight.js/lib/languages/markdown";
import php from "highlight.js/lib/languages/php";
import powershell from "highlight.js/lib/languages/powershell";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import scss from "highlight.js/lib/languages/scss";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

/**
 * Languages colored in the visual editor. Keep in step with the published
 * site (crates/zwa-site/src/highlight.rs, test `DOCUMENTED`) and the list
 * in the docs. The site knows more languages (bat's set); these are the
 * common ones, kept short so the app bundle stays small.
 */
export const lowlight = createLowlight({
  bash, c, cpp, csharp, css, diff, dockerfile, go, ini, java, javascript, json, kotlin, lua,
  markdown, php, powershell, python, ruby, rust, scss, sql, swift, typescript, xml, yaml,
});
// Names the site accepts that highlight.js lacks as aliases.
lowlight.registerAlias({ bash: ["shell", "console"], json: ["jsonc"] });

/**
 * Choices in the editor's code block menu: the name written after ``` and a
 * label. Typing a short name in the menu (`ts`, `py`) also finds the language.
 */
export const CODE_LANGUAGES: { value: string; label: string; aliases?: string[] }[] = [
  { value: "bash", label: "Bash・シェル", aliases: ["sh", "shell", "zsh", "console"] },
  { value: "c", label: "C" },
  { value: "cpp", label: "C++" },
  { value: "csharp", label: "C#", aliases: ["cs"] },
  { value: "css", label: "CSS" },
  { value: "diff", label: "diff" },
  { value: "dockerfile", label: "Dockerfile", aliases: ["docker"] },
  { value: "go", label: "Go", aliases: ["golang"] },
  { value: "html", label: "HTML", aliases: ["htm"] },
  { value: "ini", label: "INI" },
  { value: "java", label: "Java" },
  { value: "javascript", label: "JavaScript", aliases: ["js", "jsx", "mjs"] },
  { value: "json", label: "JSON" },
  { value: "kotlin", label: "Kotlin", aliases: ["kt"] },
  { value: "lua", label: "Lua" },
  { value: "markdown", label: "Markdown", aliases: ["md"] },
  { value: "php", label: "PHP" },
  { value: "powershell", label: "PowerShell", aliases: ["ps1", "pwsh"] },
  { value: "python", label: "Python", aliases: ["py"] },
  { value: "ruby", label: "Ruby", aliases: ["rb"] },
  { value: "rust", label: "Rust", aliases: ["rs"] },
  { value: "scss", label: "SCSS" },
  { value: "sql", label: "SQL" },
  { value: "swift", label: "Swift" },
  { value: "toml", label: "TOML" },
  { value: "typescript", label: "TypeScript", aliases: ["ts", "tsx"] },
  { value: "xml", label: "XML" },
  { value: "yaml", label: "YAML", aliases: ["yml"] },
];
