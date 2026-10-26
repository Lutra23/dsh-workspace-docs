// src/overview.ts
import { createHash as createHash2 } from "node:crypto";
import { homedir } from "node:os";
import { join as join3 } from "node:path";

// src/codegraph/indexer.ts
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readdirSync as readdirSync2, readFileSync, statSync as statSync2 } from "node:fs";
import { join as join2, relative, sep } from "node:path";
import { promisify } from "node:util";

// src/codegraph/languages.ts
import { existsSync, mkdirSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
var LANGUAGES = [
  { id: "typescript", grammar: "typescript", label: "TypeScript", extensions: [".ts", ".mts", ".cts"], bundled: true },
  { id: "tsx", grammar: "tsx", label: "TypeScript JSX", extensions: [".tsx"], bundled: true },
  { id: "javascript", grammar: "javascript", label: "JavaScript", extensions: [".js", ".mjs", ".cjs", ".jsx"], bundled: true },
  { id: "python", grammar: "python", label: "Python", extensions: [".py", ".pyi"], bundled: true },
  { id: "go", grammar: "go", label: "Go", extensions: [".go"], bundled: true },
  { id: "java", grammar: "java", label: "Java", extensions: [".java"], bundled: true },
  { id: "c", grammar: "cpp", label: "C", extensions: [".c", ".h"], bundled: true },
  { id: "cpp", grammar: "cpp", label: "C++", extensions: [".cc", ".cpp", ".cxx", ".hpp", ".hh", ".hxx"], bundled: true },
  { id: "c_sharp", grammar: "c-sharp", label: "C#", extensions: [".cs"], bundled: true },
  // Everything below is on-demand: present in the grammar package, absent from
  // the plugin's own bundle.
  { id: "rust", grammar: "rust", label: "Rust", extensions: [".rs"], bundled: false },
  { id: "ruby", grammar: "ruby", label: "Ruby", extensions: [".rb"], bundled: false },
  { id: "php", grammar: "php", label: "PHP", extensions: [".php"], bundled: false },
  { id: "bash", grammar: "bash", label: "Shell", extensions: [".sh", ".bash", ".zsh"], bundled: false },
  { id: "css", grammar: "css", label: "CSS", extensions: [".css", ".scss", ".less"], bundled: false },
  { id: "ini", grammar: "ini", label: "INI / TOML", extensions: [".ini", ".toml", ".cfg"], bundled: false },
  { id: "powershell", grammar: "powershell", label: "PowerShell", extensions: [".ps1", ".psm1", ".psd1"], bundled: false },
  { id: "regex", grammar: "regex", label: "Regular expression", extensions: [], bundled: false }
];
var BUNDLED_LANGUAGE_IDS = LANGUAGES.filter((language) => language.bundled).map((language) => language.id);
var BY_EXTENSION = (() => {
  const map = /* @__PURE__ */ new Map();
  for (const language of LANGUAGES) {
    for (const extension of language.extensions) {
      const existing = map.get(extension);
      if (existing === void 0) map.set(extension, language);
    }
  }
  return map;
})();
function languageForPath(path) {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return void 0;
  return BY_EXTENSION.get(path.slice(dot).toLowerCase());
}
function grammarPath(spec, paths) {
  const candidate = spec.bundled ? join(paths.bundledDir, `tree-sitter-${spec.grammar}.wasm`) : join(paths.downloadDir, `tree-sitter-${spec.grammar}.wasm`);
  return existsSync(candidate) ? candidate : void 0;
}
var MAX_GRAMMAR_BYTES = 12 * 1024 * 1024;
function bundledGrammarDir() {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "grammars");
}

// src/codegraph/docs.ts
var DOCUMENT_EXTENSIONS = [".md", ".mdx", ".txt", ".rst"];
var MIN_MENTION_LENGTH = 3;
var PROSE_STOP_WORDS = /* @__PURE__ */ new Set([
  "the",
  "and",
  "for",
  "not",
  "but",
  "you",
  "are",
  "was",
  "with",
  "this",
  "that",
  "from",
  "into",
  "when",
  "then",
  "than",
  "they",
  "them",
  "its",
  "has",
  "have",
  "can",
  "will",
  "may",
  "must",
  "should",
  "would",
  "could",
  "one",
  "two",
  "all",
  "any",
  "each",
  "every",
  "also",
  "only",
  "just",
  "same",
  "such",
  "some",
  "more",
  "most",
  "other",
  "over",
  "under",
  "than",
  "then",
  "there",
  "these",
  "those"
]);
function tokensOf(line) {
  const tokens = [];
  const quotedSource = /`([^`\n]+)`/gu;
  for (const match of line.matchAll(quotedSource)) {
    const run = match[1].trim();
    const last = run.split(/[\s/\\/]+/u).pop() ?? "";
    const cleaned = last.replace(/[^A-Za-z0-9_$.]/gu, "");
    if (cleaned !== "") tokens.push({ name: cleaned, quoted: true });
  }
  const bare = line.replace(/`[^`\n]*`/gu, " ");
  for (const match of bare.matchAll(/\b[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*\b/gu)) {
    tokens.push({ name: match[0], quoted: false });
  }
  return tokens;
}
function isMentionCandidate(token) {
  if (token.quoted) return true;
  if (token.name.includes(".")) return token.name.length > 2;
  const last = token.name.slice(token.name.lastIndexOf(".") + 1);
  if (last.length < MIN_MENTION_LENGTH) return false;
  return !PROSE_STOP_WORDS.has(token.name.toLowerCase());
}
function documentMentions(document, known) {
  const mentions = [];
  const lines = document.text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const seen = /* @__PURE__ */ new Set();
    for (const token of tokensOf(lines[index])) {
      if (!isMentionCandidate(token)) continue;
      const candidates = token.name.includes(".") ? [token.name, token.name.slice(token.name.lastIndexOf(".") + 1)] : [token.name];
      for (const candidate of candidates) {
        if (!known.has(candidate)) continue;
        if (seen.has(candidate)) continue;
        seen.add(candidate);
        mentions.push({ path: document.path, line: index + 1, name: candidate });
      }
    }
  }
  return mentions;
}
function knownNames(symbols) {
  const names = /* @__PURE__ */ new Map();
  for (const symbol of symbols) {
    if (!names.has(symbol.name)) names.set(symbol.name, symbol.kind);
  }
  return names;
}

// src/codegraph/parse.ts
var GRAMMAR_SHAPES = {
  typescript: typescriptShape(),
  tsx: typescriptShape(),
  // JavaScript has no `interface` / `type` / `enum` declarations, so it gets its
  // own table rather than a copy of TypeScript's: a row the grammar cannot
  // produce is a row that silently never fires.
  javascript: javascriptShape(),
  python: {
    declarations: {
      function_definition: { kind: "function", nameField: "name" },
      class_definition: { kind: "class", nameField: "name" }
    },
    scopes: ["block"],
    call: { type: "call", field: "function" },
    import: { type: "import_statement", field: "name" },
    // Python writes base classes in the class header's ARGUMENT LIST, which is also
    // how every call spells its arguments — so the type alone cannot tell them
    // apart. `parent` is what makes this row safe to declare.
    heritage: { extends: ["argument_list"], parent: "class_definition" }
  },
  go: {
    declarations: {
      function_declaration: { kind: "function", nameField: "name" },
      method_declaration: { kind: "method", nameField: "name" },
      // The name lives on the `type_spec` child; `type_declaration` itself has
      // no fields at all, which is how every Go type once went missing.
      type_spec: { kind: "type", nameField: "name" }
    },
    scopes: ["block"],
    call: { type: "call_expression", field: "function" },
    import: { type: "import_spec", field: "path" }
  },
  java: {
    declarations: {
      method_declaration: { kind: "method", nameField: "name" },
      class_declaration: { kind: "class", nameField: "name" },
      interface_declaration: { kind: "interface", nameField: "name" },
      enum_declaration: { kind: "enum", nameField: "name" }
    },
    scopes: ["class_body", "interface_body", "block"],
    call: { type: "method_invocation", field: "name" },
    // `import_declaration` has no fields; the target is a child node. The
    // `field` is empty and the extractor falls back to the first scoped name.
    import: { type: "import_declaration", field: "" },
    // Two node types for one relationship: Java spells the superclass and the
    // implemented interfaces differently, and both are type names.
    heritage: { extends: ["superclass"], implements: ["super_interfaces"] }
  },
  // C and C++ share ONE shape: they are parsed by the same `cpp` grammar, so a
  // narrower C table would only lose declarations that grammar does produce
  // (`class_specifier` in a `.h`, for instance) without gaining accuracy.
  c: cppShape(),
  cpp: cppShape(),
  c_sharp: {
    declarations: {
      method_declaration: { kind: "method", nameField: "name" },
      class_declaration: { kind: "class", nameField: "name" },
      interface_declaration: { kind: "interface", nameField: "name" },
      struct_declaration: { kind: "struct", nameField: "name" },
      enum_declaration: { kind: "enum", nameField: "name" },
      property_declaration: { kind: "variable", nameField: "name" }
    },
    scopes: ["declaration_list", "block"],
    call: { type: "invocation_expression", field: "function" },
    import: { type: "using_directive", field: "name" },
    // C# puts base types AND implemented interfaces in one `base_list`, so the
    // distinction the other languages make is not available here. Recorded as
    // `extends` — "this type is built on those" — rather than guessing which entry
    // is an interface, because a guess that lands in `implements` would answer
    // "who implements this interface" with classes that merely derive from it.
    heritage: { extends: ["base_list"] }
  },
  // Node names below were read off a REAL parse of a sample file with this
  // plugin's own grammar (`scratch/codegraph-grammars/probe.cjs`), not from
  // memory: a name the grammar does not produce fails silently, producing a
  // symbol table that looks empty for a language that works. Rust's `impl_item`
  // is deliberately absent — it declares no name of its own, and the methods
  // inside it are matched by `function_item` under the `declaration_list` scope.
  rust: {
    declarations: {
      function_item: { kind: "function", nameField: "name" },
      struct_item: { kind: "struct", nameField: "name" },
      enum_item: { kind: "enum", nameField: "name" },
      trait_item: { kind: "interface", nameField: "name" },
      // A trait's method SIGNATURE (no body) is its own node; an impl's method is
      // a `function_item`. Both must be declared or a trait's surface is missing.
      function_signature_item: { kind: "method", nameField: "name" },
      field_declaration: { kind: "variable", nameField: "name" }
    },
    scopes: ["declaration_list", "block", "impl_item"],
    call: { type: "call_expression", field: "function" },
    // `use_declaration` names its target through a scoped identifier, not a field.
    import: { type: "use_declaration", field: "" }
  },
  ruby: {
    declarations: {
      method: { kind: "method", nameField: "name" },
      singleton_method: { kind: "method", nameField: "name" },
      class: { kind: "class", nameField: "name" },
      module: { kind: "module", nameField: "name" }
    },
    scopes: ["body_statement", "block"],
    call: { type: "call", field: "method" },
    import: void 0
  },
  php: {
    declarations: {
      function_definition: { kind: "function", nameField: "name" },
      method_declaration: { kind: "method", nameField: "name" },
      class_declaration: { kind: "class", nameField: "name" },
      interface_declaration: { kind: "interface", nameField: "name" },
      trait_declaration: { kind: "class", nameField: "name" }
    },
    scopes: ["declaration_list", "compound_statement"],
    call: { type: "function_call_expression", field: "function" },
    // `namespace_use_declaration` has no field; the name is a child.
    import: { type: "namespace_use_declaration", field: "" }
  },
  bash: {
    declarations: {
      // A shell function is the only declaration the language has: no classes, no
      // types, and a variable is a runtime name rather than a code structure.
      function_definition: { kind: "function", nameField: "name" }
    },
    scopes: ["compound_statement", "function_definition"],
    call: { type: "command", field: "name" },
    import: void 0
  },
  // PowerShell: the grammar is in the same package, and it is one of the few
  // "not a mainstream compiled language" ids a Windows project actually uses.
  //
  // Neither declaration names its name as a FIELD — measured against the real
  // grammar: `function_statement` carries a `function_name` CHILD and
  // `class_statement` a `simple_name` child — which is why the shape grew
  // `nameChild`. A `nameField: 'name'` here would have produced an empty symbol
  // list and looked like a language this plugin does not support.
  powershell: {
    declarations: {
      function_statement: { kind: "function", nameChild: "function_name" },
      class_statement: { kind: "class", nameChild: "simple_name" }
    },
    scopes: ["script_block", "script_block_body", "statement_list"],
    call: { type: "command", field: "command_name" },
    import: void 0
  },
  // CSS, INI and regex are DOWNLOADABLE and PARSEABLE but carry no extraction
  // shape on purpose. Their "declarations" are a selector, a config key and a
  // regular-expression fragment: none names a thing a caller can reference, so an
  // edge to one would be a graph entry no one can act on. The settings page
  // reports them as "No extraction rules" instead of promising a symbol table,
  // which is the same honesty `LANGUAGE_UNSUPPORTED` gives an uninstalled grammar.
  css: { declarations: {}, scopes: [], call: void 0, import: void 0 },
  ini: { declarations: {}, scopes: [], call: void 0, import: void 0 },
  regex: { declarations: {}, scopes: [], call: void 0, import: void 0 }
};
function typescriptShape() {
  return {
    declarations: {
      function_declaration: { kind: "function", nameField: "name" },
      class_declaration: { kind: "class", nameField: "name" },
      method_definition: { kind: "method", nameField: "name" },
      interface_declaration: { kind: "interface", nameField: "name" },
      type_alias_declaration: { kind: "type", nameField: "name" },
      enum_declaration: { kind: "enum", nameField: "name" },
      // `lexical_declaration` has NO `name` field: the name sits on each
      // `variable_declarator` child. Matching the declarator is what makes
      // `export const f = () => {}` a symbol at all.
      variable_declarator: { kind: "variable", nameField: "name" },
      // Class fields holding arrow functions (`onClick = () => {}`). The TS
      // grammar names this `public_field_definition`; `field_definition` is not
      // a node it produces.
      public_field_definition: { kind: "variable", nameField: "name" }
    },
    scopes: ["class_body", "object", "statement_block"],
    call: { type: "call_expression", field: "function" },
    import: { type: "import_statement", field: "source" },
    heritage: { extends: ["extends_clause"], implements: ["implements_clause"] },
    typeRef: ["type_annotation"],
    exportSurface: { statement: "export_statement", specifier: "export_specifier" }
  };
}
function javascriptShape() {
  return {
    declarations: {
      function_declaration: { kind: "function", nameField: "name" },
      class_declaration: { kind: "class", nameField: "name" },
      method_definition: { kind: "method", nameField: "name" },
      variable_declarator: { kind: "variable", nameField: "name" },
      field_definition: { kind: "variable", nameField: "property" }
    },
    scopes: ["class_body", "object", "statement_block"],
    call: { type: "call_expression", field: "function" },
    import: { type: "import_statement", field: "source" }
  };
}
function cppShape() {
  return {
    declarations: {
      function_definition: { kind: "function", nameField: "declarator" },
      class_specifier: { kind: "class", nameField: "name" },
      struct_specifier: { kind: "struct", nameField: "name" },
      enum_specifier: { kind: "enum", nameField: "name" }
    },
    scopes: ["block", "field_declaration_list"],
    call: { type: "call_expression", field: "function" },
    import: { type: "preproc_include", field: "path" }
  };
}
var SUPPORTED_LANGUAGE_IDS = Object.entries(GRAMMAR_SHAPES).filter(([, shape]) => Object.keys(shape.declarations).length > 0).map(([id]) => id);
function symbolId(path, kind, name, parent) {
  return parent === void 0 ? `${path}#${kind}:${name}` : `${path}#${kind}:${parent}.${name}`;
}
function leafName(node) {
  if (node.type === "identifier" || node.type === "type_identifier" || node.type === "field_identifier" || node.type === "property_identifier" || node.type === "name") return node.text;
  const declarator = node.childForFieldName("declarator");
  if (declarator !== null) return leafName(declarator);
  const name = node.childForFieldName("name");
  if (name !== null) return name.text;
  return "";
}
function calleeName(node) {
  const direct = leafName(node);
  if (direct !== "") return direct;
  for (const field of ["property", "field"]) {
    const member = node.childForFieldName(field);
    if (member !== null) return leafName(member);
  }
  const constructor = node.childForFieldName("constructor");
  if (constructor !== null) return leafName(constructor);
  return "";
}
var SKIP_TYPE_NAMES = /* @__PURE__ */ new Set([
  "any",
  "unknown",
  "never",
  "void",
  "string",
  "number",
  "boolean",
  "object",
  "symbol",
  "bigint",
  "null",
  "undefined",
  "this",
  "true",
  "false",
  "Array",
  "Promise",
  "Map",
  "Set",
  "Record",
  "Partial",
  "Readonly"
]);
function collectByType(node, type) {
  const found = [];
  const visit = (current) => {
    for (const child of current.namedChildren) {
      if (child.type === type) found.push(child);
      visit(child);
    }
  };
  visit(node);
  return found;
}
function typeNamesOf(node) {
  const found = [];
  const add = (name) => {
    if (name !== "" && !found.includes(name)) found.push(name);
  };
  const visit = (current) => {
    if (NAMED_TYPE_NODES.has(current.type)) {
      add(typeNameOf(current));
      return;
    }
    for (const child of current.namedChildren) visit(child);
  };
  for (const child of node.namedChildren) visit(child);
  return found;
}
var NAMED_TYPE_NODES = /* @__PURE__ */ new Set(["type_identifier", "identifier", "nested_type_identifier", "scoped_type_identifier"]);
function typeNameOf(node) {
  if (SKIP_TYPE_NAMES.has(node.type)) return "";
  if (node.type === "type_identifier" || node.type === "identifier" || node.type === "nested_type_identifier") {
    const text = node.text.trim();
    if (text === "") return "";
    const last = text.includes(".") ? text.slice(text.lastIndexOf(".") + 1) : text;
    return SKIP_TYPE_NAMES.has(last) ? "" : last;
  }
  for (const child of node.namedChildren) {
    const name = typeNameOf(child);
    if (name !== "") return name;
  }
  return "";
}
function extractSymbols(root, path, language) {
  const shape = Object.hasOwn(GRAMMAR_SHAPES, language) ? GRAMMAR_SHAPES[language] : void 0;
  if (shape === void 0 || Object.keys(shape.declarations).length === 0) {
    return { symbols: [], calls: [], imports: [], heritage: [], typeRefs: [], exports: [], hasError: hasErrorNode(root), unsupported: "noShape" };
  }
  const symbols = [];
  const calls = [];
  const imports = [];
  const heritage = [];
  const typeRefs = [];
  const exports = [];
  const used = /* @__PURE__ */ new Map();
  const walk = (node, parent, ownerId, parentType) => {
    const declaration = Object.hasOwn(shape.declarations, node.type) ? shape.declarations[node.type] : void 0;
    if (declaration !== void 0) {
      const fieldNode = declaration.nameField === void 0 ? null : node.childForFieldName(declaration.nameField);
      const nameNode = fieldNode ?? (declaration.nameChild === void 0 ? null : node.namedChildren.find((child) => child.type === declaration.nameChild) ?? null);
      const rawName = nameNode === null ? "" : declaration.nameField === "declarator" ? leafName(nameNode) : nameNode.text;
      const name = rawName.trim();
      if (name !== "" && !/[{}\[\],]/u.test(name)) {
        const base = symbolId(path, declaration.kind, name, parent);
        const seen = used.get(base) ?? 0;
        used.set(base, seen + 1);
        const id = seen === 0 ? base : `${base}#${String(seen)}`;
        symbols.push({
          id,
          path,
          name,
          kind: declaration.kind,
          line: node.startPosition.row + 1,
          parent
        });
        for (const child of node.namedChildren) walk(child, name, id, node.type);
        return;
      }
    }
    if (shape.call !== void 0 && node.type === shape.call.type) {
      const callee = node.childForFieldName(shape.call.field);
      if (callee !== null) {
        const name = calleeName(callee);
        if (name !== "") calls.push({ name, line: node.startPosition.row + 1, owner: ownerId });
      }
    }
    if (shape.import !== void 0 && node.type === shape.import.type) {
      const target = shape.import.field === "" ? firstNamedChild(node) : node.childForFieldName(shape.import.field);
      if (target !== null) {
        const names = [];
        for (const clause of collectByType(node, "import_specifier")) {
          const local = clause.childForFieldName("alias") ?? clause.childForFieldName("name") ?? clause.namedChildren[0];
          const text = local?.text.trim() ?? "";
          if (text !== "" && !names.includes(text)) names.push(text);
        }
        for (const child of node.namedChildren) {
          if (child.type === "identifier" && child.text.trim() !== "" && !names.includes(child.text.trim())) {
            names.push(child.text.trim());
          }
        }
        imports.push({
          specifier: target.text.replace(/^['"]|['"]$/gu, ""),
          line: node.startPosition.row + 1,
          names
        });
      }
    }
    if (shape.heritage !== void 0) {
      const isExtends = shape.heritage.extends?.includes(node.type) === true;
      const isImplements = shape.heritage.implements?.includes(node.type) === true;
      const parentMatches = shape.heritage.parent === void 0 || parentType === shape.heritage.parent;
      if ((isExtends || isImplements) && parentMatches && ownerId !== void 0) {
        for (const name of typeNamesOf(node)) {
          heritage.push({ from: ownerId, name, line: node.startPosition.row + 1, kind: isExtends ? "extends" : "implements" });
        }
      }
    }
    if (shape.typeRef !== void 0 && shape.typeRef.includes(node.type)) {
      for (const child of node.namedChildren) {
        const name = typeNameOf(child);
        if (name !== "") typeRefs.push({ name, line: node.startPosition.row + 1, owner: ownerId });
      }
    }
    if (shape.exportSurface !== void 0 && node.type === shape.exportSurface.statement) {
      const line = node.startPosition.row + 1;
      const wanted = shape.exportSurface.specifier;
      const specifiers = wanted === void 0 ? [] : collectByType(node, wanted);
      const fromSpecifier = node.childForFieldName("source")?.text.replace(/^['"]|['"]$/gu, "") ?? void 0;
      if (specifiers.length > 0) {
        for (const specifier of specifiers) {
          const name = specifier.childForFieldName("name")?.text ?? specifier.namedChildren[0]?.text ?? "";
          if (name !== "") exports.push({ name: name.trim(), line, all: false, from: fromSpecifier });
        }
      } else if (/\bexport\s*\*/u.test(node.text)) {
        const source = fromSpecifier ?? "";
        if (source !== "") exports.push({ name: source, line, all: true, from: source });
      } else {
        const declarators = collectByType(node, "variable_declarator");
        const own = node.namedChildren.find((child) => child.childForFieldName("name") !== null);
        const name = own?.childForFieldName("name")?.text ?? declarators[0]?.childForFieldName("name")?.text ?? "";
        if (name !== "") exports.push({ name: name.trim(), line, all: false, from: fromSpecifier });
      }
    }
    for (const child of node.namedChildren) walk(child, parent, ownerId, node.type);
  };
  walk(root, void 0, void 0, void 0);
  return {
    symbols,
    calls,
    imports,
    heritage,
    typeRefs,
    exports,
    hasError: hasErrorNode(root),
    unsupported: false
  };
}
function firstNamedChild(node) {
  return node.namedChildren[0] ?? null;
}
function hasErrorNode(node) {
  if (node.type === "ERROR") return true;
  for (const child of node.namedChildren) if (hasErrorNode(child)) return true;
  return false;
}
var MAX_SHARED_TARGETS = 10;
function linkTargets(targets, sameFile = []) {
  if (targets.length === 0) return [];
  if (targets.length === 1) return targets;
  if (sameFile.length > 0) return sameFile.slice(0, MAX_SHARED_TARGETS);
  if (targets.length > MAX_SHARED_TARGETS) return [];
  return targets;
}
function relationEdges(parsed, fileId, resolve, resolveModule) {
  const edges = [];
  const local = /* @__PURE__ */ new Map();
  for (const symbol of parsed.symbols) {
    if (`file:${symbol.path}` !== fileId) continue;
    const list = local.get(symbol.name);
    if (list === void 0) local.set(symbol.name, [symbol.id]);
    else list.push(symbol.id);
  }
  const importedFrom = /* @__PURE__ */ new Map();
  if (resolveModule !== void 0) {
    for (const clause of parsed.imports) {
      const target = resolveModule(clause.specifier);
      if (target === void 0) continue;
      for (const name of clause.names) {
        const list = importedFrom.get(name);
        if (list === void 0) importedFrom.set(name, [target]);
        else if (!list.includes(target)) list.push(target);
      }
    }
  }
  const add = (from, name, kind, line) => {
    const localTargets = local.get(name) ?? [];
    if (localTargets.length > 0) {
      for (const target of linkTargets(resolve(name), localTargets)) edges.push({ from, to: target, kind, line });
      return;
    }
    const sources = importedFrom.get(name);
    if (sources !== void 0 && sources.length > 0) {
      const inSources = resolve(name).filter((id) => sources.some((source) => id.startsWith(`${source}#`)));
      for (const target of linkTargets(inSources)) edges.push({ from, to: target, kind, line });
      return;
    }
    for (const target of linkTargets(resolve(name))) edges.push({ from, to: target, kind, line });
  };
  for (const relation of parsed.heritage) add(relation.from, relation.name, relation.kind, relation.line);
  const seenTypeRefs = /* @__PURE__ */ new Set();
  for (const reference of parsed.typeRefs) {
    const from = reference.owner ?? fileId;
    const key = `${from}\0${reference.name}`;
    if (seenTypeRefs.has(key)) continue;
    seenTypeRefs.add(key);
    add(from, reference.name, "type_refs", reference.line);
  }
  for (const entry of parsed.exports) {
    const fromFile = entry.from === void 0 ? void 0 : resolveModule?.(entry.from);
    if (entry.all) {
      if (fromFile !== void 0) edges.push({ from: fileId, to: `file:${fromFile}`, kind: "exports", line: entry.line });
      continue;
    }
    if (fromFile !== void 0) {
      for (const target of linkTargets(resolve(entry.name).filter((id) => id.startsWith(`${fromFile}#`)))) {
        edges.push({ from: fileId, to: target, kind: "exports", line: entry.line });
      }
      continue;
    }
    for (const target of local.get(entry.name) ?? []) {
      edges.push({ from: fileId, to: target, kind: "exports", line: entry.line });
    }
  }
  return edges;
}
function callEdges(parsed, callerId, resolve) {
  const edges = [];
  const local = /* @__PURE__ */ new Map();
  for (const symbol of parsed.symbols) {
    const list = local.get(symbol.name);
    if (list === void 0) local.set(symbol.name, [symbol.id]);
    else list.push(symbol.id);
  }
  for (const call of parsed.calls) {
    const targets = linkTargets(resolve(call.name), local.get(call.name) ?? []);
    if (targets.length === 0) continue;
    for (const target of targets) {
      edges.push({ from: call.owner ?? callerId, to: target, kind: "references", line: call.line });
    }
  }
  return edges;
}

// src/codegraph/store.ts
import { DatabaseSync } from "node:sqlite";
import { mkdirSync as mkdirSync2, unlinkSync } from "node:fs";
import { dirname as dirname2 } from "node:path";
var SCHEMA_VERSION = 3;
var SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS files (
  path  TEXT PRIMARY KEY,
  mtime INTEGER NOT NULL,
  size  INTEGER NOT NULL,
  hash  TEXT NOT NULL,
  lang  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS symbols (
  id     TEXT PRIMARY KEY,
  path   TEXT NOT NULL,
  name   TEXT NOT NULL,
  kind   TEXT NOT NULL,
  line   INTEGER NOT NULL,
  parent TEXT
);

CREATE TABLE IF NOT EXISTS edges (
  src  TEXT NOT NULL,
  dst  TEXT NOT NULL,
  kind TEXT NOT NULL,
  line INTEGER NOT NULL,
  -- The same reference can be observed twice in one parse (a duplicate match, or
  -- an import emitted from both the file node and a symbol). Without this, the
  -- duplicate survives into impact output and inflates every count.
  PRIMARY KEY (src, dst, kind, line)
) WITHOUT ROWID;

-- The queries this plugin actually runs, as indexes rather than scans:
-- find-by-name (symbols), impact (edges by destination), file outline
-- (symbols by path). The edges table is WITHOUT ROWID keyed on
-- (src, dst, kind, line), so its primary key already answers "edges by source";
-- only the destination direction needs its own index.
CREATE INDEX IF NOT EXISTS symbols_name ON symbols(name);
CREATE INDEX IF NOT EXISTS symbols_path ON symbols(path);
CREATE INDEX IF NOT EXISTS edges_dst  ON edges(dst);
-- The source side of every edge needs its own index; its absence cost minutes of
-- blocked event loop. Every write deletes a file's outgoing edges with
-- "WHERE src = ?" \u2014 once per symbol \u2014 and without this index each of those is a
-- full scan of the edge table. Measured on a 1613-file project: the first pass
-- held the kernel for 241 SECONDS, which is why the window went dead and the new
-- session button did nothing.
CREATE INDEX IF NOT EXISTS edges_src  ON edges(src);
`;
function openGraph(file) {
  mkdirSync2(dirname2(file), { recursive: true });
  const db = openOrRecreate(file);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec("PRAGMA foreign_keys = ON");
  const stored = readMetaValue(db, "schema_version");
  if (stored !== void 0 && stored !== String(SCHEMA_VERSION)) {
    db.exec("DROP TABLE IF EXISTS edges");
    db.exec("DROP TABLE IF EXISTS symbols");
    db.exec("DROP TABLE IF EXISTS files");
    db.exec("DROP TABLE IF EXISTS meta");
  }
  db.exec(SCHEMA);
  writeMetaValue(db, "schema_version", String(SCHEMA_VERSION));
  return { db, close: () => {
    db.close();
  } };
}
function hasTable(db, name) {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
  return row !== void 0;
}
function openOrRecreate(file) {
  try {
    const db = new DatabaseSync(file, { timeout: 5e3 });
    hasTable(db, "meta");
    return db;
  } catch (error) {
    const code = error.code ?? "";
    const message = error instanceof Error ? error.message : String(error);
    const unusable = /SQLITE_NOTADB|SQLITE_CORRUPT|file is not a database|malformed/i.test(`${code} ${message}`);
    if (!unusable) throw error;
    for (const target of [file, `${file}-wal`, `${file}-shm`]) {
      try {
        unlinkSync(target);
      } catch {
      }
    }
    return new DatabaseSync(file, { timeout: 5e3 });
  }
}
function readMetaValue(db, key) {
  if (!hasTable(db, "meta")) return void 0;
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key);
  return row?.value;
}
function writeMetaValue(db, key, value) {
  db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}
function writeProjectMeta(db, meta) {
  writeMetaValue(db, "project", JSON.stringify(meta));
}
function readProjectMeta(db) {
  const raw = readMetaValue(db, "project");
  if (raw === void 0) return void 0;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return void 0;
  }
  if (parsed === null || typeof parsed !== "object") return void 0;
  const meta = parsed;
  const strings = ["cwd", "name", "head"];
  const numbers = ["indexedAt", "fileCount", "symbolCount", "edgeCount", "missingLanguage", "noRules", "parseErrors"];
  const booleans = ["truncated", "removalSkipped"];
  for (const key of strings) if (typeof meta[key] !== "string") return void 0;
  for (const key of numbers) if (typeof meta[key] !== "number" || !Number.isFinite(meta[key])) return void 0;
  for (const key of booleans) if (typeof meta[key] !== "boolean") return void 0;
  return parsed;
}
function allRows(db, sql, ...params) {
  return db.prepare(sql).all(...params);
}
function oneRow(db, sql, ...params) {
  return db.prepare(sql).get(...params);
}
function readFiles(db) {
  const rows = allRows(db, "SELECT path, mtime, size, hash, lang FROM files");
  return new Map(rows.map((row) => [row.path, row]));
}
function symbolsOf(db) {
  return allRows(db, "SELECT id, path, name, kind, line, parent FROM symbols");
}
function replaceFile(db, file, symbols, edges) {
  const previous = db.prepare("SELECT id FROM symbols WHERE path = ?").all(file.path);
  const ids = new Set(previous.map((row) => row.id));
  const fileId = fileNodeId(file.path);
  ids.add(fileId);
  const next = new Set(symbols.map((symbol) => symbol.id));
  const retired = [...ids].filter((id) => id !== fileId && !next.has(id));
  const deleteOutgoing = db.prepare("DELETE FROM edges WHERE src = ?");
  const deleteIncoming = db.prepare("DELETE FROM edges WHERE dst = ?");
  const deleteOutgoingOfFile = db.prepare("DELETE FROM edges WHERE src >= ? AND src < ?");
  const upper = `${file.path}$`;
  db.exec("BEGIN");
  try {
    deleteOutgoingOfFile.run(`${file.path}#`, upper);
    deleteOutgoing.run(fileId);
    for (const id of retired) deleteIncoming.run(id);
    db.prepare("DELETE FROM symbols WHERE path = ?").run(file.path);
    db.prepare("INSERT INTO files (path, mtime, size, hash, lang) VALUES (?, ?, ?, ?, ?) ON CONFLICT(path) DO UPDATE SET mtime = excluded.mtime, size = excluded.size, hash = excluded.hash, lang = excluded.lang").run(file.path, file.mtime, file.size, file.hash, file.lang);
    const insertSymbol = db.prepare("INSERT INTO symbols (id, path, name, kind, line, parent) VALUES (?, ?, ?, ?, ?, ?)");
    for (const symbol of symbols) {
      insertSymbol.run(symbol.id, symbol.path, symbol.name, symbol.kind, symbol.line, symbol.parent ?? null);
    }
    const insertEdge = db.prepare("INSERT OR IGNORE INTO edges (src, dst, kind, line) VALUES (?, ?, ?, ?)");
    for (const edge of edges) {
      insertEdge.run(edge.from, edge.to, edge.kind, edge.line);
    }
    db.exec("COMMIT");
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
    }
    throw error;
  }
}
function forgetFile(db, path) {
  const rows = db.prepare("SELECT id FROM symbols WHERE path = ?").all(path);
  const ids = new Set(rows.map((row) => row.id));
  ids.add(fileNodeId(path));
  db.exec("BEGIN");
  try {
    for (const id of ids) {
      db.prepare("DELETE FROM edges WHERE src = ?").run(id);
      db.prepare("DELETE FROM edges WHERE dst = ?").run(id);
    }
    db.prepare("DELETE FROM symbols WHERE path = ?").run(path);
    db.prepare("DELETE FROM files WHERE path = ?").run(path);
    db.exec("COMMIT");
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
    }
    throw error;
  }
}
function fileNodeId(path) {
  return `file:${path}`;
}
function graphStats(db) {
  const files = db.prepare("SELECT COUNT(*) AS n FROM files").get().n;
  const symbols = db.prepare("SELECT COUNT(*) AS n FROM symbols").get().n;
  const edges = db.prepare("SELECT COUNT(*) AS n FROM edges").get().n;
  return { files, symbols, edges };
}

// src/codegraph/indexer.ts
var execFileAsync = promisify(execFile);
var MAX_FILES = 2e4;
var SKIP_DIRS = /* @__PURE__ */ new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "out",
  "target",
  "vendor",
  ".next",
  ".nuxt",
  ".cache",
  ".turbo",
  ".venv",
  "venv",
  "__pycache__",
  "coverage",
  ".test-dist",
  "lib",
  "release",
  "runtime-dist",
  "bundled-kernel",
  // .NET build output. Measured on a real WPF project: `obj/Release/net9.0-windows`
  // and its `win-x64` variant contributed ten files that declare nothing, and the
  // view listed them as two blocks of "0 symbols" under a path nobody wrote. A
  // generated file has no place in a graph of the source.
  "obj",
  "bin"
]);
var MAX_FILE_BYTES = 15e5;
async function gitHead(cwd) {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd,
      windowsHide: true,
      timeout: 1e4
    });
    return stdout.trim();
  } catch {
    return "";
  }
}
function extensionOf(path) {
  const dot = path.lastIndexOf(".");
  const slash = path.lastIndexOf("/");
  if (dot <= slash || dot < 0) return "";
  return path.slice(dot).toLowerCase();
}
function scanProject(root, limit = MAX_FILES, skipDir) {
  const files = [];
  const tooLarge = [];
  let truncated = false;
  const walk = (dir) => {
    if (truncated) return;
    let entries;
    try {
      entries = readdirSync2(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (truncated) return;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".") || skipDir?.(entry.name) === true) continue;
        walk(join2(dir, entry.name));
        continue;
      }
      if (!entry.isFile()) continue;
      const absolute = join2(dir, entry.name);
      const relativePath = relative(root, absolute).split(sep).join("/");
      const isDocument = DOCUMENT_EXTENSIONS.includes(extensionOf(relativePath));
      if (!isDocument && languageForPath(relativePath) === void 0) continue;
      let stat;
      try {
        stat = statSync2(absolute);
      } catch {
        continue;
      }
      if (stat.size > MAX_FILE_BYTES) {
        tooLarge.push(relativePath);
        continue;
      }
      if (files.length >= limit) {
        truncated = true;
        return;
      }
      files.push({ path: relativePath, mtime: Math.floor(stat.mtimeMs), size: stat.size, document: isDocument });
    }
  };
  let rootUnreadable = false;
  try {
    readdirSync2(root);
  } catch {
    rootUnreadable = true;
  }
  if (!rootUnreadable) walk(root);
  return { files, truncated, tooLarge, rootUnreadable };
}
function resolveImport(from, specifier, exists) {
  if (!specifier.startsWith(".")) return void 0;
  const base = from.split("/").slice(0, -1);
  const parts = specifier.split("/");
  const stack = [...base];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  const joined = stack.join("/");
  const candidates = [
    joined,
    `${joined}.ts`,
    `${joined}.tsx`,
    `${joined}.js`,
    `${joined}.mjs`,
    `${joined}.cjs`,
    `${joined}.py`,
    `${joined}.go`,
    `${joined}.java`,
    `${joined}.cs`,
    `${joined}.c`,
    `${joined}.cpp`,
    `${joined}/index.ts`,
    `${joined}/index.tsx`,
    `${joined}/index.js`
  ];
  return candidates.find((candidate) => exists(candidate));
}
function namesIndex(graph) {
  const byName = /* @__PURE__ */ new Map();
  for (const row of allRows(graph.db, "SELECT id, name FROM symbols")) {
    const list = byName.get(row.name);
    if (list === void 0) byName.set(row.name, [row.id]);
    else list.push(row.id);
  }
  return (name) => byName.get(name) ?? [];
}
function forgetStatCache(graph, entries) {
  if (entries.length === 0) return;
  const drop = graph.db.prepare("DELETE FROM files WHERE path = ?");
  graph.db.exec("BEGIN");
  try {
    for (const entry of entries) drop.run(entry.path);
    graph.db.exec("COMMIT");
  } catch (error) {
    try {
      graph.db.exec("ROLLBACK");
    } catch {
    }
    void error;
  }
}
async function indexProject(graph, root, parse, now = Date.now, limit = MAX_FILES, skipDir) {
  const started = now();
  const known = readFiles(graph.db);
  const scan = scanProject(root, limit, skipDir);
  const seen = new Set(scan.tooLarge);
  let parsed = 0;
  let skipped = 0;
  let missingLanguage = 0;
  let noRules = 0;
  let parseErrors = 0;
  let documentsDirty = false;
  let symbolsChanged = false;
  const pending = [];
  const BREATHE_MS = 8;
  let lastBreathe = Date.now();
  const breatheIfDue = async () => {
    if (Date.now() - lastBreathe < BREATHE_MS) return;
    await new Promise((resolve) => {
      setImmediate(resolve);
    });
    lastBreathe = Date.now();
  };
  for (const candidate of scan.files) {
    seen.add(candidate.path);
    const previous = known.get(candidate.path);
    if (previous !== void 0 && previous.mtime === candidate.mtime && previous.size === candidate.size) {
      skipped += 1;
      continue;
    }
    if (candidate.document) {
      let docHash;
      try {
        const bytes = readFileSync(join2(root, candidate.path));
        docHash = createHash("sha256").update(bytes).digest("hex");
      } catch {
        continue;
      }
      if (previous !== void 0 && previous.hash === docHash) {
        graph.db.prepare("UPDATE files SET mtime = ?, size = ? WHERE path = ?").run(candidate.mtime, candidate.size, candidate.path);
        skipped += 1;
        continue;
      }
      replaceFile(graph.db, { path: candidate.path, mtime: candidate.mtime, size: candidate.size, hash: docHash, lang: "document" }, [], []);
      documentsDirty = true;
      continue;
    }
    const language = languageForPath(candidate.path);
    if (language === void 0) continue;
    let source;
    let hash;
    try {
      const bytes = readFileSync(join2(root, candidate.path));
      hash = createHash("sha256").update(bytes).digest("hex");
      source = bytes.toString("utf8");
    } catch {
      continue;
    }
    if (previous !== void 0 && previous.hash === hash) {
      graph.db.prepare("UPDATE files SET mtime = ?, size = ? WHERE path = ?").run(candidate.mtime, candidate.size, candidate.path);
      skipped += 1;
      continue;
    }
    const result = await parse(source, candidate.path, language.id);
    if (result.unsupported !== false) {
      if (result.unsupported === "missing") missingLanguage += 1;
      else noRules += 1;
      graph.db.prepare("INSERT INTO files (path, mtime, size, hash, lang) VALUES (?, ?, ?, ?, ?) ON CONFLICT(path) DO UPDATE SET mtime = excluded.mtime, size = excluded.size, hash = excluded.hash, lang = excluded.lang").run(candidate.path, candidate.mtime, candidate.size, hash, language.id);
      continue;
    }
    if (result.hasError) parseErrors += 1;
    const record = {
      path: candidate.path,
      mtime: candidate.mtime,
      size: candidate.size,
      hash,
      lang: language.id
    };
    const fileId = fileNodeId(candidate.path);
    replaceFile(graph.db, record, result.symbols, result.symbols.map((symbol) => ({
      from: fileId,
      to: symbol.id,
      kind: "contains",
      line: symbol.line
    })));
    pending.push({ path: candidate.path, fileId, parsed: result });
    symbolsChanged = true;
    parsed += 1;
    await breatheIfDue();
  }
  if (pending.length > 0) {
    const insert = graph.db.prepare("INSERT OR IGNORE INTO edges (src, dst, kind, line) VALUES (?, ?, ?, ?)");
    const knownPaths = /* @__PURE__ */ new Set([...known.keys(), ...seen]);
    const resolveOnce = namesIndex(graph);
    const FILES_PER_COMMIT = 50;
    let inBatch = 0;
    graph.db.exec("BEGIN");
    try {
      for (const entry of pending) {
        for (const edge of callEdges(entry.parsed, entry.fileId, resolveOnce)) {
          insert.run(edge.from, edge.to, edge.kind, edge.line);
        }
        for (const edge of relationEdges(
          entry.parsed,
          entry.fileId,
          resolveOnce,
          // The same resolver `imports` uses: a re-export and an import name a path
          // in exactly the same way, so a star edge points at the node the rest of the
          // graph uses instead of at a `./`-relative string that joins to nothing.
          (specifier) => resolveImport(entry.path, specifier, (path) => knownPaths.has(path))
        )) {
          insert.run(edge.from, edge.to, edge.kind, edge.line);
        }
        for (const specifier of entry.parsed.imports) {
          const target = resolveImport(entry.path, specifier.specifier, (path) => knownPaths.has(path));
          if (target === void 0) continue;
          insert.run(entry.fileId, fileNodeId(target), "imports", specifier.line);
        }
        inBatch += 1;
        if (inBatch >= FILES_PER_COMMIT) {
          graph.db.exec("COMMIT");
          inBatch = 0;
          await new Promise((resolve) => {
            setImmediate(resolve);
          });
          graph.db.exec("BEGIN");
        }
      }
      graph.db.exec("COMMIT");
    } catch (error) {
      try {
        graph.db.exec("ROLLBACK");
      } catch {
      }
      forgetStatCache(graph, pending);
      throw error;
    }
  }
  const documentPaths = allRows(graph.db, "SELECT path FROM files WHERE lang = ?", "document");
  if (documentPaths.length > 0 && (documentsDirty || symbolsChanged)) {
    const byName = /* @__PURE__ */ new Map();
    const declared = [];
    for (const symbol of symbolsOf(graph.db)) {
      declared.push(symbol);
      const existing = byName.get(symbol.name);
      if (existing === void 0) byName.set(symbol.name, [symbol]);
      else existing.push(symbol);
    }
    const known2 = knownNames(declared);
    const MAX_TARGETS_PER_MENTION = 1;
    const clear = graph.db.prepare("DELETE FROM edges WHERE kind = 'documents' AND dst = ?");
    const insert = graph.db.prepare("INSERT OR IGNORE INTO edges (src, dst, kind, line) VALUES (?, ?, ?, ?)");
    const DOCS_PER_COMMIT = 25;
    let inBatch = 0;
    graph.db.exec("BEGIN");
    try {
      for (const row of documentPaths) {
        const target = fileNodeId(row.path);
        clear.run(target);
        let text;
        try {
          text = readFileSync(join2(root, row.path)).toString("utf8");
        } catch {
          continue;
        }
        for (const mention of documentMentions({ path: row.path, text }, known2)) {
          const targets = byName.get(mention.name) ?? [];
          const keep = targets.length > MAX_TARGETS_PER_MENTION ? targets.slice(0, MAX_TARGETS_PER_MENTION) : targets;
          for (const symbol of keep) {
            insert.run(symbol.id, target, "documents", mention.line);
          }
        }
        inBatch += 1;
        if (inBatch >= DOCS_PER_COMMIT) {
          graph.db.exec("COMMIT");
          inBatch = 0;
          await new Promise((resolve) => {
            setImmediate(resolve);
          });
          graph.db.exec("BEGIN");
        }
      }
      graph.db.exec("COMMIT");
    } catch (error) {
      try {
        graph.db.exec("ROLLBACK");
      } catch {
      }
      forgetStatCache(graph, documentPaths.map((row) => ({ path: row.path })));
      throw error;
    }
  }
  const removalSkipped = scan.truncated || scan.rootUnreadable;
  let removed = 0;
  if (!removalSkipped) {
    for (const path of known.keys()) {
      if (seen.has(path)) continue;
      forgetFile(graph.db, path);
      removed += 1;
      symbolsChanged = true;
    }
  }
  const stats = graphStats(graph.db);
  const meta = {
    cwd: root,
    name: root.split(/[\\/]/u).filter((part) => part !== "").pop() ?? root,
    head: await gitHead(root),
    indexedAt: now(),
    fileCount: stats.files,
    symbolCount: stats.symbols,
    edgeCount: stats.edges,
    truncated: scan.truncated,
    removalSkipped,
    missingLanguage,
    noRules,
    parseErrors
  };
  writeProjectMeta(graph.db, meta);
  return {
    parsed,
    skipped,
    removed,
    truncated: scan.truncated,
    missingLanguage,
    noRules,
    parseErrors,
    tooLarge: scan.tooLarge.length,
    durationMs: now() - started,
    removalSkipped
  };
}
function isStale(meta, head) {
  if (meta === void 0) return true;
  if (meta.head === "" && head === "") return false;
  if (meta.head === "") return true;
  return meta.head !== head;
}

// src/codegraph/query.ts
function toSymbolView(row) {
  return { ...row, parent: row.parent ?? void 0 };
}
function readSymbol(graph, id) {
  const row = oneRow(graph.db, "SELECT id, name, kind, path, line, parent FROM symbols WHERE id = ?", id);
  return row === void 0 ? void 0 : toSymbolView(row);
}
var SYMBOL_COLUMNS = "id, name, kind, path, line, parent";
function projectOverview(graph, limit) {
  const counts = oneRow(
    graph.db,
    `SELECT (SELECT COUNT(*) FROM files) AS files,
            (SELECT COUNT(*) FROM symbols) AS symbols,
            (SELECT COUNT(*) FROM edges) AS edges`
  ) ?? { files: 0, symbols: 0, edges: 0 };
  const languages = allRows(
    graph.db,
    `SELECT lang, COUNT(*) AS files FROM files WHERE lang <> 'document'
     GROUP BY lang ORDER BY files DESC, lang ASC`
  );
  const entryRows = allRows(
    graph.db,
    `SELECT f.path AS path, COUNT(s.id) AS n
     FROM files f
     LEFT JOIN symbols s ON s.path = f.path
     WHERE f.lang <> 'document'
       AND NOT EXISTS (
         SELECT 1 FROM edges e
         WHERE e.kind = 'imports' AND e.dst = ('file:' || f.path)
       )
     GROUP BY f.path
     ORDER BY
       CASE
         WHEN f.path LIKE '%test%' OR f.path LIKE '%spec%'
           OR f.path LIKE '%example%' OR f.path LIKE '%fixture%'
           OR f.path LIKE '%/scripts/%' THEN 2
         WHEN f.path LIKE '%/cli.ts' OR f.path LIKE '%/main.ts'
           OR f.path LIKE '%/index.ts' OR f.path LIKE '%/entry.ts'
           OR f.path LIKE '%/app.ts' OR f.path LIKE '%/cli.js'
           OR f.path LIKE '%/main.js' OR f.path LIKE '%/index.js' THEN 0
         ELSE 1
       END ASC,
       n DESC, f.path ASC
     LIMIT ?`,
    limit + 1
  );
  const hubRows = allRows(
    graph.db,
    // Top-level declarations only, and never a `variable`.
    //
    // Measured on a real 1771-file project: the unguarded query ranked
    // `.filter` (975 referrers), `.trim` (512) and `.includes` (476) as the
    // project's hubs — built-in method names that happen to match a variable the
    // parser recorded, which tell a reader nothing about this codebase. Nested
    // declarations and bare variables are where those collisions live; a
    // top-level function or type is a real public surface.
    //
    // A test helper is demoted for the same reason a test file is: measured on
    // the same project, `chatSetup` in `test/chat-support.ts` outranked every
    // production symbol because tests call it everywhere. It is a real hub — but
    // not the one to read first when learning the codebase.
    //
    // COUNT(*) over the edges, NOT COUNT(DISTINCT e.src).
    //
    // The distinct-source count was measured at 203 for a symbol whose edge count
    // is 664, and `codegraph_impact` reports the edge count — so the overview named
    // a number a third of what the tool the model is being invited to call would
    // say. Two numbers for one concept is worse than either number alone: the model
    // cannot tell which to trust. This count also matches what the row limit is
    // applied to, so "664 call site(s)" and "TRUNCATED at 40" describe one list.
    //
    // AND the name is not shared by several declarations.
    //
    // Measured after widening the list to ten rows: `startsWith` appeared three times
    // (554 / 554 / 553) and `ok` eight. The reference count of a SHARED NAME is the
    // sum over every unrelated declaration of it, so the number says how common the
    // word is, not how important any one symbol is. A hub list exists to teach the
    // vocabulary of THIS project, and `startsWith` is not part of it.
    `SELECT e.dst AS id, COUNT(*) AS n
     FROM edges e JOIN symbols s ON s.id = e.dst
     WHERE e.kind = 'references'
       AND s.parent IS NULL
       AND s.kind IN ('function', 'class', 'interface', 'type', 'enum')
       AND (SELECT COUNT(*) FROM symbols s2 WHERE s2.name = s.name) <= 2
     GROUP BY e.dst
     ORDER BY
       CASE WHEN s.path LIKE '%test%' OR s.path LIKE '%spec%'
                  OR s.path LIKE '%fixture%' THEN 1 ELSE 0 END ASC,
       n DESC, e.dst ASC
     LIMIT ?`,
    limit + 1
  );
  const entryCandidates = entryRows.slice(0, limit).map((row) => {
    const first = oneRow(
      graph.db,
      `SELECT ${SYMBOL_COLUMNS} FROM symbols WHERE path = ?
       ORDER BY CASE WHEN kind IN ('function', 'class', 'method') THEN 0 ELSE 1 END, line
       LIMIT 1`,
      row.path
    );
    return {
      path: row.path,
      symbol: first === void 0 ? void 0 : toSymbolView(first),
      symbols: row.n
    };
  });
  const hubs = hubRows.slice(0, limit).flatMap((row) => {
    const symbol = readSymbol(graph, row.id);
    return symbol === void 0 ? [] : [{ symbol, references: row.n }];
  });
  return {
    files: counts.files,
    symbols: counts.symbols,
    edges: counts.edges,
    byLanguage: languages,
    entryCandidates,
    hubs,
    truncated: entryRows.length > limit || hubRows.length > limit
  };
}

// src/codegraph/queue.ts
function createIndexQueue(run) {
  const records = /* @__PURE__ */ new Map();
  const waiting = [];
  let running = false;
  let disposed = false;
  let activeController;
  const record = (cwd) => {
    let entry = records.get(cwd);
    if (entry === void 0) {
      entry = { state: "unindexed", indexedAt: 0, lastOutcome: void 0, failure: void 0, queued: false, pending: void 0 };
      records.set(cwd, entry);
    }
    return entry;
  };
  const nameOf = (cwd) => cwd.split(/[\\/]/u).filter((part) => part !== "").pop() ?? cwd;
  const pump = async () => {
    if (running) return;
    running = true;
    try {
      for (let job = waiting.shift(); job !== void 0; job = waiting.shift()) {
        if (disposed) {
          job.fail(new Error("the code graph queue was disposed"));
          continue;
        }
        const entry = record(job.cwd);
        entry.state = "indexing";
        entry.queued = false;
        const controller = new AbortController();
        activeController = controller;
        try {
          const outcome = await run(job.cwd, controller.signal);
          if (!disposed) {
            entry.state = "current";
            entry.indexedAt = Date.now();
            entry.lastOutcome = outcome;
            entry.failure = void 0;
          }
          job.settle(outcome);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (!disposed) {
            entry.state = "failed";
            entry.failure = message;
          }
          job.fail(new Error(message));
        } finally {
          activeController = void 0;
          entry.pending = void 0;
        }
      }
    } finally {
      running = false;
    }
  };
  return {
    request(cwd) {
      if (disposed) return Promise.reject(new Error("the code graph queue was disposed"));
      const entry = record(cwd);
      if (entry.pending !== void 0) return entry.pending;
      let settleJob = () => {
      };
      let failJob = () => {
      };
      const promise = new Promise((resolve, reject) => {
        settleJob = resolve;
        failJob = reject;
      });
      entry.pending = promise;
      waiting.push({ cwd, settle: settleJob, fail: failJob });
      entry.queued = true;
      queueMicrotask(() => {
        void pump();
      });
      return promise;
    },
    statuses() {
      return [...records.entries()].map(([cwd, entry]) => ({
        cwd,
        name: nameOf(cwd),
        state: entry.state,
        indexedAt: entry.indexedAt,
        lastOutcome: entry.lastOutcome,
        failure: entry.failure,
        queued: entry.queued
      }));
    },
    status(cwd) {
      return this.statuses().find((status) => status.cwd === cwd);
    },
    adopt(cwd, meta) {
      if (meta === void 0) return;
      const entry = record(cwd);
      if (entry.state === "unindexed") {
        entry.state = "current";
        entry.indexedAt = meta.indexedAt;
      }
    },
    markStale(cwd) {
      const entry = record(cwd);
      if (entry.state === "current") entry.state = "stale";
    },
    forget(cwd) {
      const entry = records.get(cwd);
      if (entry === void 0) return;
      records.delete(cwd);
    },
    dispose() {
      disposed = true;
      activeController?.abort();
      for (const job of waiting.splice(0)) job.fail(new Error("the code graph queue was disposed"));
      for (const entry of records.values()) {
        entry.queued = false;
        entry.pending = void 0;
        if (entry.state === "indexing") entry.state = "unindexed";
      }
    }
  };
}

// src/codegraph/tree-sitter.ts
import { statSync as statSync3 } from "node:fs";
import { Language, Parser } from "web-tree-sitter";
var runtime;
var parsers = /* @__PURE__ */ new Map();
function loadRuntime(runtimeWasm) {
  runtime ??= Parser.init({ locateFile: () => runtimeWasm });
  return runtime;
}
async function parserFor(grammarFile, languageId, runtimeWasm) {
  const size = statSync3(grammarFile).size;
  const cached = parsers.get(languageId);
  if (cached !== void 0 && cached.grammarFile === grammarFile && cached.grammarSize === size) return cached;
  await loadRuntime(runtimeWasm);
  const language = await Language.load(grammarFile);
  const parser = new Parser();
  parser.setLanguage(language);
  const entry = { parser, grammarFile, grammarSize: size };
  parsers.set(languageId, entry);
  return entry;
}
async function parseFile(grammarFile, runtimeWasm, source, path, languageId) {
  const { parser } = await parserFor(grammarFile, languageId, runtimeWasm);
  const tree = parser.parse(source);
  if (tree === null) {
    return { symbols: [], calls: [], imports: [], heritage: [], typeRefs: [], exports: [], hasError: true, unsupported: false };
  }
  return extractSymbols(tree.rootNode, path, languageId);
}

// src/overview.ts
var INDEXING_NOTE = "\u4EE3\u7801\u56FE\u7D22\u5F15\u4E2D\uFF08\u9996\u6B21\u7EA6 10\u201320 \u79D2\uFF0C\u540E\u53F0\u8FD0\u884C\uFF09\u2014\u2014\u5148\u6309\u4E0B\u9762\u7684\u6587\u4EF6\u6E05\u5355\u770B\uFF0C\u4E0B\u4E00\u8F6E\u4F1A\u8865\u4E0A\u5165\u53E3\u5019\u9009\u4E0E\u6838\u5FC3\u7B26\u53F7\u3002";
function dshHome() {
  const env = process.env.DSH_HOME;
  return env !== void 0 && env !== "" ? env : join3(homedir(), ".dsh");
}
function graphFileFor(root) {
  const key = createHash2("sha256").update(root).digest("hex").slice(0, 32);
  return join3(dshHome(), "storages", "dsh-workspace-docs", "projects", key, "graph.db");
}
function grammarPaths() {
  return {
    bundledDir: bundledGrammarDir(),
    downloadDir: join3(dshHome(), "storages", "dsh-workspace-docs", "grammars")
  };
}
var EMPTY_FILE = { symbols: [], calls: [], imports: [], heritage: [], typeRefs: [], exports: [], hasError: false, unsupported: "missing" };
async function parseSource(source, path, languageId) {
  const language = LANGUAGES.find((entry) => entry.id === languageId);
  if (language === void 0) return EMPTY_FILE;
  const grammar = grammarPath(language, grammarPaths());
  if (grammar === void 0) return EMPTY_FILE;
  return await parseFile(grammar, join3(bundledGrammarDir(), "web-tree-sitter.wasm"), source, path, languageId);
}
async function indexDirectory(root, graphFile, skipDir) {
  const graph = openGraph(graphFile);
  try {
    await indexProject(graph, root, parseSource, Date.now, void 0, skipDir);
    return projectOverview(graph, 20);
  } finally {
    try {
      graph.close();
    } catch {
    }
  }
}
function renderOverviewBlock(overview, state, meta, limit = 8) {
  if (overview === void 0 || overview.files === 0) return "";
  const languages = overview.byLanguage.slice(0, 3).map((entry) => `${entry.lang} ${String(entry.files)}`).join("\u3001");
  const flags = [
    state === "stale" ? "\u7D22\u5F15\u843D\u540E\u4E8E\u5DE5\u4F5C\u533A\uFF0C\u540E\u53F0\u66F4\u65B0\u4E2D" : "",
    meta?.truncated === true ? "\u6587\u4EF6\u6570\u8D85\u8FC7\u7D22\u5F15\u4E0A\u9650\uFF0C\u56FE\u4E0D\u5B8C\u6574" : "",
    overview.truncated ? "\u5217\u8868\u5DF2\u622A\u65AD" : ""
  ].filter(Boolean);
  const lines = [
    `## \u4EE3\u7801\u56FE\u6982\u89C8\uFF08\u81EA\u52A8\u751F\u6210\uFF09`,
    `- \u89C4\u6A21\uFF1A${String(overview.files)} \u6587\u4EF6 / ${String(overview.symbols)} \u7B26\u53F7 / ${String(overview.edges)} \u6761\u8FB9${languages === "" ? "" : `\uFF1B${languages}`}${flags.length === 0 ? "" : `\uFF08${flags.join("\uFF1B")}\uFF09`}`
  ];
  const budget = Math.min(limit, Math.max(3, Math.round(Math.log10(Math.max(overview.files, 1)) * 3)));
  const entries = overview.entryCandidates.slice(0, budget);
  if (entries.length > 0) {
    lines.push("- \u5165\u53E3\u5019\u9009\uFF08\u6CA1\u6709\u4EFB\u4F55\u6587\u4EF6 import \u5B83\uFF0C\u901A\u5E38\u4ECE\u8FD9\u91CC\u5F00\u59CB\u8BFB\uFF09\uFF1A");
    for (const entry of entries) lines.push(`  - ${entry.path}${entry.symbol === void 0 ? "" : ` \xB7 \u4ECE ${entry.symbol.kind} ${entry.symbol.name} \u5F00\u59CB`}`);
  }
  const hubs = overview.hubs.slice(0, Math.min(budget, 6));
  if (hubs.length > 0) {
    lines.push("- \u6838\u5FC3\u7B26\u53F7\uFF08\u88AB\u5F15\u7528\u6700\u591A\uFF0C\u5148\u8BFB\u8FD9\u4E9B\u5EFA\u7ACB\u8BCD\u6C47\uFF09\uFF1A");
    for (const hub of hubs) lines.push(`  - ${hub.symbol.kind} ${hub.symbol.name} \xB7 ${hub.symbol.path}:${String(hub.symbol.line)} \xB7 ${String(hub.references)} \u5904\u5F15\u7528`);
  }
  return lines.join("\n");
}
function createCodeOverview(options = {}) {
  const enabled = options.enabled !== false;
  const limit = options.limit ?? 8;
  const ignored = new Set((options.ignored ?? []).map((entry) => entry.toLowerCase()));
  const skipDir = (name) => name.startsWith("_") || ignored.has(name.toLowerCase());
  const graphs = /* @__PURE__ */ new Map();
  const lastGood = /* @__PURE__ */ new Map();
  const lastHeadCheck = /* @__PURE__ */ new Map();
  function graphFor(cwd) {
    const existing = graphs.get(cwd);
    if (existing !== void 0) return existing;
    const opened = openGraph(graphFileFor(cwd));
    graphs.set(cwd, opened);
    queue.adopt(cwd, readProjectMeta(opened.db));
    return opened;
  }
  const queue = createIndexQueue(async (cwd) => indexProject(graphFor(cwd), cwd, parseSource, Date.now, void 0, skipDir));
  function checkFreshness(cwd) {
    const now = Date.now();
    if (now - (lastHeadCheck.get(cwd) ?? 0) < 3e4) return;
    lastHeadCheck.set(cwd, now);
    void gitHead(cwd).then((head) => {
      const meta = readProjectMeta(graphFor(cwd).db);
      if (isStale(meta, head)) {
        queue.markStale(cwd);
        void queue.request(cwd).catch(() => {
        });
      }
    }).catch(() => {
    });
  }
  return {
    render(cwd) {
      if (!enabled || typeof cwd !== "string" || cwd === "") return { text: "", graph: false };
      const status = queue.status(cwd);
      if (status === void 0) {
        void queue.request(cwd).catch(() => {
        });
        return { text: INDEXING_NOTE, graph: false };
      }
      if (status.state === "indexing" || status.state === "unindexed") {
        const previous = lastGood.get(cwd);
        return previous === void 0 ? { text: INDEXING_NOTE, graph: false } : { text: `${previous}
\uFF08\u540E\u53F0\u66F4\u65B0\u4E2D\uFF09`, graph: true };
      }
      if (status.state === "failed") {
        return { text: `\u4EE3\u7801\u56FE\u7D22\u5F15\u672A\u5B8C\u6210\uFF1A${status.failure ?? "\u672A\u77E5\u9519\u8BEF"}\uFF1B\u4E0B\u9762\u7684\u6587\u4EF6\u6E05\u5355\u4ECD\u7136\u53EF\u7528\u3002`, graph: false };
      }
      try {
        const graph = graphFor(cwd);
        const meta = readProjectMeta(graph.db);
        const overview = projectOverview(graph, limit);
        const text = renderOverviewBlock(overview, status.state === "stale" ? "stale" : "current", meta, limit);
        if (text === "") return { text: "", graph: false };
        lastGood.set(cwd, text);
        checkFreshness(cwd);
        return { text, graph: true };
      } catch {
        return { text: "", graph: false };
      }
    },
    dispose() {
      try {
        queue.dispose();
      } catch {
      }
      for (const graph of graphs.values()) {
        try {
          graph.close();
        } catch {
        }
      }
      graphs.clear();
      lastGood.clear();
      lastHeadCheck.clear();
    }
  };
}
export {
  createCodeOverview,
  graphFileFor,
  indexDirectory,
  renderOverviewBlock
};
