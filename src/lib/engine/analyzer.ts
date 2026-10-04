// Semantic analyzer: parses JS/TS via the TypeScript compiler API.
// Builds import/call graphs, extracts symbols, detects health issues.
import fs from "fs";
import path from "path";
import * as ts from "typescript";
import { db } from "@/lib/db";
import { isAnalyzableFile, isIgnoredPath, ENGINE_CONFIG } from "./config";
import { hashContent, normalizeBody, tokenSignature, relPath } from "./store";
import { isKnownGlobal } from "./errorParser";

type SymbolKind = "function" | "method" | "arrow" | "class" | "component" | "interface" | "type" | "constant";

type ParsedSymbol = {
  name: string;
  kind: SymbolKind;
  isExported: boolean;
  startLine: number;
  endLine: number;
  paramCount: number;
  unusedParams: number;
  isStub: boolean;
  hasTodo: boolean;
  complexity: number;
  bodyHash: string;
  signature: string;
  bodyText: string;
};

type ParsedFile = {
  path: string; // relative posix
  imports: { specifier: string; names: string[]; line: number }[];
  calls: { name: string; line: number; member: boolean }[];
  symbols: ParsedSymbol[];
  todos: { line: number; text: string }[];
};

// ---------------------------------------------------------------------------
// AST walk
// ---------------------------------------------------------------------------

function getLine(sf: ts.SourceFile, pos: number): number {
  return sf.getLineAndCharacterOfPosition(pos).line + 1;
}

function isStubBody(bodyText: string): boolean {
  const t = normalizeBody(bodyText);
  if (!t || t === "{}" || t === "" || t === "{};") return true;
  if (/not implemented|unimplemented|todo:? implement|throw new error\(.?not.?/.test(t)) return true;
  if (/^return (undefined|null);?$/.test(t)) return true;
  // body that only contains comments
  const stripped = t.replace(/["'`][^"'`]*["'`]/g, "");
  if (stripped.length < 3) return true;
  return false;
}

function countComplexity(node: ts.Node): number {
  let c = 1;
  const visit = (n: ts.Node) => {
    switch (n.kind) {
      case ts.SyntaxKind.IfStatement:
      case ts.SyntaxKind.ForStatement:
      case ts.SyntaxKind.ForOfStatement:
      case ts.SyntaxKind.ForInStatement:
      case ts.SyntaxKind.WhileStatement:
      case ts.SyntaxKind.DoStatement:
      case ts.SyntaxKind.CaseClause:
      case ts.SyntaxKind.CatchClause:
      case ts.SyntaxKind.ConditionalExpression:
      case ts.SyntaxKind.TryStatement:
        c++;
        break;
      case ts.SyntaxKind.LogicalAndOperator:
      case ts.SyntaxKind.LogicalOrOperator:
      case ts.SyntaxKind.NullishKeyword:
        c++;
        break;
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return c;
}

function extractName(node: ts.Node): string | null {
  if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) {
    return node.name?.text ?? null;
  }
  if (ts.isVariableStatement(node)) {
    for (const decl of node.declarationList.declarations) {
      if (ts.isIdentifier(decl.name)) return decl.name.text;
    }
  }
  return null;
}

function hasExportModifier(node: ts.Node): boolean {
  const mods = (node as { modifiers?: ts.NodeArray<ts.ModifierLike> }).modifiers;
  return !!mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

function parseJsxComponent(node: ts.Node, body: ts.Node | undefined): boolean {
  if (!body) return false;
  if (node.getSourceFile().fileName.endsWith(".tsx") || node.getSourceFile().fileName.endsWith(".jsx")) {
    let hasJsx = false;
    const visit = (n: ts.Node) => {
      if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n)) hasJsx = true;
      ts.forEachChild(n, visit);
    };
    visit(body);
    return hasJsx;
  }
  return false;
}

function analyzeSourceFile(absFile: string, rootPath: string, content: string): ParsedFile {
  const sf = ts.createSourceFile(absFile, content, ts.ScriptTarget.Latest, true);
  const rel = relPath(rootPath, absFile);
  const parsed: ParsedFile = { path: rel, imports: [], calls: [], symbols: [], todos: [] };

  // TODO / FIXME comments (including trivia)
  const trivia = sf.getFullText().slice(0, sf.getStart());
  for (const m of [...trivia.matchAll(/\/\/\s*(TODO|FIXME)[:\s](.+)/gi)]) {
    parsed.todos.push({ line: 1, text: `${m[1]}: ${m[2].trim()}`.slice(0, 160) });
  }
  sf.forEachChild((node) => {
    // full text comments per node range
    const { text } = sf;
    const start = node.getFullStart();
    const end = node.getEnd();
    const chunk = text.slice(start, end);
    for (const m of [...chunk.matchAll(/(?:\/\/|\/\*+|<!--)\s*(TODO|FIXME)[:\s]([^\n*]{3,160})/gi)]) {
      parsed.todos.push({ line: getLine(sf, node.getStart()), text: `${m[1].toUpperCase()}: ${m[2].trim()}`.slice(0, 160) });
    }
  });

  // imports
  const visitImports = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const names: string[] = [];
      const clause = node.importClause;
      if (clause?.name) names.push(clause.name.text);
      if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const el of clause.namedBindings.elements) names.push((el.propertyName || el.name).text);
      }
      parsed.imports.push({ specifier: (node.moduleSpecifier as ts.StringLiteral).text, names, line: getLine(sf, node.getStart()) });
    }
    if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const names: string[] = [];
      if (node.exportClause && ts.isNamedExports(node.exportClause)) {
        for (const el of node.exportClause.elements) names.push((el.propertyName || el.name).text);
      }
      parsed.imports.push({ specifier: (node.moduleSpecifier as ts.StringLiteral).text, names, line: getLine(sf, node.getStart()) });
    }
    // require(...) and dynamic import()
    if (
      ts.isCallExpression(node) &&
      ((ts.isIdentifier(node.expression) && node.expression.text === "require") ||
        node.expression.kind === ts.SyntaxKind.ImportKeyword) &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      parsed.imports.push({ specifier: (node.arguments[0] as ts.StringLiteral).text, names: [], line: getLine(sf, node.getStart()) });
    }
    ts.forEachChild(node, visitImports);
  };
  sf.forEachChild(visitImports);

  // symbols + calls
  const registerSymbol = (
    node: ts.Node,
    name: string,
    kind: SymbolKind,
    body: ts.Node | undefined,
    params?: ts.NodeArray<ts.ParameterDeclaration>
  ) => {
    const bodyText = body ? body.getText(sf) : "";
    const usedParams = params ? params.filter((p) => body && body.getText(sf).includes(p.name.getText(sf))).length : 0;
    const paramCount = params ? params.length : 0;
    const isComponent = kind === "function" && parseJsxComponent(node, body);
    const sig = tokenSignature(bodyText);
    parsed.symbols.push({
      name,
      kind: isComponent ? "component" : kind,
      isExported: hasExportModifier(node) || (ts.isExportAssignment(node.parent as ts.Node) as unknown as boolean) || false,
      startLine: getLine(sf, node.getStart()),
      endLine: getLine(sf, node.getEnd()),
      paramCount,
      unusedParams: paramCount - usedParams,
      isStub: body ? isStubBody(bodyText) : false,
      hasTodo: /TODO|FIXME/i.test(bodyText),
      complexity: countComplexity(node),
      bodyHash: hashContent(normalizeBody(bodyText)).slice(0, 24),
      signature: JSON.stringify(sig),
      bodyText,
    });
  };

  const visitSymbols = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name) {
      registerSymbol(node, node.name.text, "function", node.body, node.parameters);
    } else if (ts.isMethodDeclaration(node) && node.name && ts.isIdentifier(node.name)) {
      registerSymbol(node, node.name.text, "method", node.body, node.parameters);
    } else if (ts.isVariableStatement(node)) {
      const exported = hasExportModifier(node);
      for (const decl of node.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name)) continue;
        const init = decl.initializer;
        if (!init) {
          parsed.symbols.push({
            name: decl.name.text,
            kind: "constant",
            isExported: exported,
            startLine: getLine(sf, node.getStart()),
            endLine: getLine(sf, node.getEnd()),
            paramCount: 0,
            unusedParams: 0,
            isStub: false,
            hasTodo: /TODO|FIXME/i.test(node.getText(sf)),
            complexity: 1,
            bodyHash: "",
            signature: "{}",
            bodyText: "",
          });
          continue;
        }
        if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
          registerSymbol(node, decl.name.text, ts.isArrowFunction(init) ? "arrow" : "function", init.body, init.parameters);
        } else if (ts.isClassExpression(init)) {
          registerSymbol(node, decl.name.text, "class", undefined, undefined);
        }
      }
    } else if (ts.isClassDeclaration(node) && node.name) {
      registerSymbol(node, node.name.text, "class", node.body, undefined);
    } else if (ts.isInterfaceDeclaration(node) && node.name) {
      registerSymbol(node, node.name.text, "interface", undefined, undefined);
    } else if (ts.isTypeAliasDeclaration(node) && node.name) {
      registerSymbol(node, node.name.text, "type", undefined, undefined);
    }
    ts.forEachChild(node, visitSymbols);
  };
  sf.forEachChild(visitSymbols);

  // calls
  const visitCalls = (node: ts.Node) => {
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      if (ts.isIdentifier(node.expression)) {
        parsed.calls.push({ name: node.expression.text, line: getLine(sf, node.getStart()), member: false });
      } else if (ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.name)) {
        // method call on an object (e.g. res.writeHead) — tracked but never flagged as missing
        parsed.calls.push({ name: node.expression.name.text, line: getLine(sf, node.getStart()), member: true });
      }
    }
    ts.forEachChild(node, visitCalls);
  };
  sf.forEachChild(visitCalls);

  return parsed;
}

// ---------------------------------------------------------------------------
// Module resolution
// ---------------------------------------------------------------------------

function resolveSpecifier(fromFileRel: string, spec: string, fileSet: Set<string>): { local?: string; external: boolean } {
  if (!spec.startsWith(".") && !spec.startsWith("@/")) return { external: true };
  const fromDir = path.posix.dirname(fromFileRel);
  let base: string;
  if (spec.startsWith("@/")) base = path.posix.join("src", spec.slice(2));
  else base = path.posix.normalize(path.posix.join(fromDir, spec));

  const candidates = [
    base,
    `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.jsx`, `${base}.mjs`, `${base}.cjs`,
    `${base}/index.ts`, `${base}/index.tsx`, `${base}/index.js`, `${base}/index.jsx`,
  ];
  for (const c of candidates) {
    if (fileSet.has(c)) return { local: c, external: false };
  }
  return { external: false }; // unresolved local → broken import
}

function listProjectFiles(rootPath: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 12) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (isIgnoredPath(abs, rootPath)) continue;
      if (e.isDirectory()) walk(abs, depth + 1);
      else if (e.isFile() && isAnalyzableFile(abs)) out.push(abs);
    }
  };
  walk(rootPath, 0);
  return out;
}

// ---------------------------------------------------------------------------
// Graph helpers
// ---------------------------------------------------------------------------

/** Tarjan SCC — returns groups of mutually-connected nodes (size>1 = cycle). */
function findCycles(adj: Map<string, Set<string>>): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const sccs: string[][] = [];
  let counter = 0;

  const strongconnect = (v: string) => {
    index.set(v, counter);
    low.set(v, counter);
    counter++;
    stack.push(v);
    onStack.add(v);
    for (const w of adj.get(v) || []) {
      if (!index.has(w)) {
        strongconnect(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      }
    }
    if (low.get(v) === index.get(v)) {
      const comp: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        comp.push(w);
      } while (w !== v);
      if (comp.length > 1) sccs.push(comp);
    }
  };

  for (const v of adj.keys()) if (!index.has(v)) strongconnect(v);
  return sccs;
}

const ENTRY_PATTERNS = [
  /(^|\/)index\.(ts|tsx|js|jsx|mjs|cjs)$/,
  /(^|\/)main\.(ts|tsx|js|jsx)$/,
  /(^|\/)server\.(ts|tsx|js|jsx)$/,
  /(^|\/)app\//,
  /(^|\/)pages\//,
  /(^|\/)route\.(ts|tsx|js)$/,
  /(^|\/)layout\.(ts|tsx|js)$/,
  /(^|\/)page\.(ts|tsx|js)$/,
  /\.config\.(ts|js|mjs|cjs)$/,
  /\.d\.ts$/,
  /\.(test|spec)\.(ts|tsx|js|jsx)$/,
  /(^|\/)(vite|vitest|jest|next|webpack)\.config\./,
];

function isEntryFile(rel: string): boolean {
  return ENTRY_PATTERNS.some((re) => re.test(rel));
}

function isTestFile(rel: string): boolean {
  return /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(rel) || /(^|\/)__tests__\//.test(rel) || /(^|\/)tests?\//.test(rel);
}

// ---------------------------------------------------------------------------
// Main analysis
// ---------------------------------------------------------------------------

export async function analyzeProject(projectId: string, rootPath: string): Promise<{
  symbols: number;
  dependencies: number;
  issues: number;
  cycles: number;
}> {
  const absFiles = listProjectFiles(rootPath);
  const fileSet = new Set(absFiles.map((f) => relPath(rootPath, f)));

  // read + parse all files
  const parsedFiles: ParsedFile[] = [];
  for (const abs of absFiles) {
    try {
      const stat = fs.statSync(abs);
      if (stat.size > ENGINE_CONFIG.maxFileSize) continue;
      const content = fs.readFileSync(abs, "utf8");
      parsedFiles.push(analyzeSourceFile(abs, rootPath, content));
    } catch {
      // unreadable file — skip
    }
  }

  const filesByPath = new Map(parsedFiles.map((f) => [f.path, f]));

  // ---- symbol name index (name -> [file, symbol]) ----
  const nameIndex = new Map<string, { file: string; name: string; exported: boolean }[]>();
  for (const f of parsedFiles) {
    for (const s of f.symbols) {
      const arr = nameIndex.get(s.name) || [];
      arr.push({ file: f.path, name: s.name, exported: s.isExported });
      nameIndex.set(s.name, arr);
    }
  }

  // ---- resolve imports -> dependency edges + import-name map ----
  type Edge = { from: string; to: string; kind: string; external: boolean; resolved: boolean };
  const edges: Edge[] = [];
  const brokenImports: { from: string; spec: string; line: number }[] = [];
  const importNameMap = new Map<string, Map<string, string>>(); // file -> importedName -> resolved local path

  for (const f of parsedFiles) {
    const fmap = new Map<string, string>();
    for (const imp of f.imports) {
      const { local, external } = resolveSpecifier(f.path, imp.specifier, fileSet);
      if (external) {
        edges.push({ from: f.path, to: imp.specifier, kind: "import", external: true, resolved: true });
      } else if (local) {
        edges.push({ from: f.path, to: local, kind: "import", external: false, resolved: true });
        for (const n of imp.names) fmap.set(n, local);
      } else {
        edges.push({ from: f.path, to: imp.specifier, kind: "import", external: false, resolved: false });
        brokenImports.push({ from: f.path, spec: imp.specifier, line: imp.line });
      }
    }
    importNameMap.set(f.path, fmap);
  }

  // ---- call graph: which symbols are referenced ----
  const callRef = new Map<string, number>(); // "file::name" -> inbound count
  for (const f of parsedFiles) {
    const fmap = importNameMap.get(f.path)!;
    const ownNames = new Set(f.symbols.map((s) => s.name));
    for (const call of f.calls) {
      if (call.member) continue; // method calls are not resolvable symbol refs
      if (isKnownGlobal(call.name)) continue;
      if (ownNames.has(call.name)) {
        const key = `${f.path}::${call.name}`;
        callRef.set(key, (callRef.get(key) || 0) + 1);
      }
      const targetFile = fmap.get(call.name);
      if (targetFile) {
        const key = `${targetFile}::${call.name}`;
        callRef.set(key, (callRef.get(key) || 0) + 1);
      }
    }
  }

  // ---- test links ----
  const testFiles = parsedFiles.filter((f) => isTestFile(f.path));
  const testedNames = new Set<string>();
  for (const t of testFiles) {
    for (const s of t.symbols) testedNames.add(s.name);
    for (const c of t.calls) testedNames.add(c.name);
    for (const imp of t.imports) testedNames.add(...imp.names);
  }

  // ---- persist symbols ----
  await db.symbol.deleteMany({ where: { projectId } });
  const symbolRows: {
    projectId: string; filePath: string; name: string; kind: string; isExported: boolean;
    startLine: number; endLine: number; paramCount: number; unusedParams: number;
    isStub: boolean; hasTodo: boolean; complexity: number; bodyHash: string; signature: string;
    callCount: number; isTested: boolean;
  }[] = [];

  for (const f of parsedFiles) {
    for (const s of f.symbols) {
      symbolRows.push({
        projectId,
        filePath: f.path,
        name: s.name,
        kind: s.kind,
        isExported: s.isExported,
        startLine: s.startLine,
        endLine: s.endLine,
        paramCount: s.paramCount,
        unusedParams: s.unusedParams,
        isStub: s.isStub,
        hasTodo: s.hasTodo,
        complexity: s.complexity,
        bodyHash: s.bodyHash,
        signature: s.signature,
        callCount: callRef.get(`${f.path}::${s.name}`) || 0,
        isTested: testedNames.has(s.name),
      });
    }
  }
  if (symbolRows.length) await db.symbol.createMany({ data: symbolRows });

  // ---- persist dependencies ----
  await db.dependency.deleteMany({ where: { projectId } });
  const depKey = new Set<string>();
  const depRows = edges
    .map((e) => ({
      projectId,
      fromPath: e.from,
      toPath: e.to,
      kind: e.kind,
      external: e.external,
      resolved: e.resolved,
    }))
    .filter((e) => {
      const k = `${e.fromPath}->${e.toPath}:${e.kind}`;
      if (depKey.has(k)) return false;
      depKey.add(k);
      return true;
    });
  if (depRows.length) await db.dependency.createMany({ data: depRows });

  // ---- build issue list ----
  type NewIssue = {
    kind: string; severity: string; title: string; detail?: string;
    filePath?: string; symbolName?: string; relatedPaths?: string[];
  };
  const issues: NewIssue[] = [];

  // broken imports
  for (const b of cap(brokenImports, ENGINE_CONFIG.maxIssuesPerKind)) {
    issues.push({
      kind: "broken-import",
      severity: "critical",
      title: `Broken import: "${b.spec}" cannot be resolved`,
      detail: JSON.stringify({ specifier: b.spec, line: b.line }),
      filePath: b.from,
    });
  }

  // circular dependencies
  const localAdj = new Map<string, Set<string>>();
  for (const e of edges) {
    if (e.external || !e.resolved) continue;
    if (!localAdj.has(e.from)) localAdj.set(e.from, new Set());
    localAdj.get(e.from)!.add(e.to);
    if (!localAdj.has(e.to)) localAdj.set(e.to, new Set());
  }
  const cycles = findCycles(localAdj);
  for (const cyc of cap(cycles, 20)) {
    issues.push({
      kind: "circular-dep",
      severity: "warning",
      title: `Circular dependency (${cyc.length} files)`,
      detail: JSON.stringify({ cycle: cyc }),
      filePath: cyc[0],
      relatedPaths: cyc,
    });
  }

  // orphan files
  const inbound = new Map<string, number>();
  for (const e of edges) {
    if (e.external || !e.resolved) continue;
    inbound.set(e.to, (inbound.get(e.to) || 0) + 1);
  }
  const orphans = [...fileSet].filter((f) => !inbound.get(f) && !isEntryFile(f) && !isTestFile(f));
  for (const o of cap(orphans, ENGINE_CONFIG.maxIssuesPerKind)) {
    issues.push({
      kind: "orphan-file",
      severity: "info",
      title: `Orphan file: never imported by any other file`,
      filePath: o,
    });
  }

  // duplicate & near-duplicate functions
  const byBodyHash = new Map<string, symbolRowsType>();
  const dupReported = new Set<string>();
  const nearDupCandidates = [...symbolRows].filter((s) => s.kind !== "constant" && s.kind !== "interface" && s.kind !== "type" && s.bodyHash);
  for (const s of nearDupCandidates) {
    const group = byBodyHash.get(s.bodyHash);
    if (group) {
      const key = [group.filePath + group.name, s.filePath + s.name].sort().join("|");
      if (!dupReported.has(key)) {
        dupReported.add(key);
        issues.push({
          kind: "duplicate",
          severity: "warning",
          title: `Duplicate implementation: ${group.name}() == ${s.name}()`,
          filePath: s.filePath,
          symbolName: s.name,
          relatedPaths: [group.filePath],
        });
      }
    } else {
      byBodyHash.set(s.bodyHash, s);
    }
  }
  // near duplicates (dice > 0.88), O(n²) but symbols are manageable per project
  const NEAR = 0.88;
  const sigOf = (s: symbolRowsType) => {
    try {
      return JSON.parse(s.signature || "{}") as Record<string, number>;
    } catch {
      return {};
    }
  };
  for (let i = 0; i < Math.min(nearDupCandidates.length, 400); i++) {
    const a = nearDupCandidates[i];
    const sa = sigOf(a);
    if (!Object.keys(sa).length) continue;
    for (let j = i + 1; j < Math.min(nearDupCandidates.length, 400); j++) {
      const b = nearDupCandidates[j];
      if (a.bodyHash === b.bodyHash) continue;
      if (a.filePath === b.filePath && a.name === b.name) continue;
      const sb = sigOf(b);
      if (!Object.keys(sb).length) continue;
      const score = dice(sa, sb);
      if (score >= NEAR) {
        issues.push({
          kind: "near-duplicate",
          severity: "info",
          title: `Near-duplicate logic: ${a.name}() ≈ ${b.name}() (${Math.round(score * 100)}% similar)`,
          filePath: b.filePath,
          symbolName: b.name,
          relatedPaths: [a.filePath],
          detail: JSON.stringify({ similarity: score }),
        });
        if (issues.filter((x) => x.kind === "near-duplicate").length > 20) break;
      }
    }
  }

  // stubs
  const stubs = symbolRows.filter((s) => s.isStub);
  for (const s of cap(stubs, ENGINE_CONFIG.maxIssuesPerKind)) {
    issues.push({
      kind: "stub",
      severity: "warning",
      title: `Unimplemented stub: ${s.name}() has an empty/placeholder body`,
      filePath: s.filePath,
      symbolName: s.name,
    });
  }

  // dead code: defined, not exported, never called
  const dead = symbolRows.filter(
    (s) => !s.isExported && s.callCount === 0 && ["function", "method", "arrow", "component"].includes(s.kind)
  );
  for (const s of cap(dead, ENGINE_CONFIG.maxIssuesPerKind)) {
    issues.push({
      kind: "dead-code",
      severity: "warning",
      title: `Dead code: ${s.name}() is never called`,
      filePath: s.filePath,
      symbolName: s.name,
    });
  }

  // exported but never referenced anywhere
  const noCallers = symbolRows.filter(
    (s) => s.isExported && s.callCount === 0 && ["function", "component"].includes(s.kind) && !isTestFile(s.filePath)
  );
  for (const s of cap(noCallers, 40)) {
    issues.push({
      kind: "no-callers",
      severity: "info",
      title: `${s.name}() is exported but never referenced`,
      filePath: s.filePath,
      symbolName: s.name,
    });
  }

  // missing implementations: bare calls to names that are not defined/imported/global
  const missingImpl = new Map<string, { file: string; name: string }>();
  for (const f of parsedFiles) {
    const fmap = importNameMap.get(f.path)!;
    const ownNames = new Set(f.symbols.map((s) => s.name));
    for (const c of f.calls) {
      if (c.member) continue; // methods on objects cannot be verified — skip
      if (isKnownGlobal(c.name)) continue;
      if (ownNames.has(c.name)) continue;
      if (fmap.has(c.name)) continue;
      if (nameIndex.has(c.name)) {
        // defined elsewhere but maybe not imported — only flag if that file isn't reachable via import of *this* file
        const defs = nameIndex.get(c.name)!;
        const importedHere = [...fmap.values()];
        const anyImported = defs.some((d) => importedHere.includes(d.file));
        if (anyImported) continue;
        // exported in another file but not imported → still call-sites may rely on globals; flag as info
        if (!missingImpl.has(`${f.path}::${c.name}`) && defs.every((d) => !isTestFile(d.file))) {
          missingImpl.set(`${f.path}::${c.name}`, { file: f.path, name: c.name });
        }
        continue;
      }
      // truly missing
      if (!missingImpl.has(`${f.path}::${c.name}`)) {
        missingImpl.set(`${f.path}::${c.name}`, { file: f.path, name: c.name });
      }
    }
  }
  for (const [, m] of [...missingImpl.entries()].slice(0, ENGINE_CONFIG.maxIssuesPerKind)) {
    issues.push({
      kind: "missing-impl",
      severity: "critical",
      title: `Missing implementation: ${m.name}() is called but never defined`,
      filePath: m.file,
      symbolName: m.name,
    });
  }

  // missing tests for exported functions/components
  const untested = symbolRows.filter(
    (s) => s.isExported && !s.isTested && ["function", "component"].includes(s.kind) && !isTestFile(s.filePath)
  );
  for (const s of cap(untested, 30)) {
    issues.push({
      kind: "missing-tests",
      severity: "info",
      title: `No tests found for exported ${s.kind} ${s.name}()`,
      filePath: s.filePath,
      symbolName: s.name,
    });
  }

  // unused params
  const unusedParams = symbolRows.filter((s) => s.unusedParams > 0 && ["function", "method", "arrow"].includes(s.kind));
  for (const s of cap(unusedParams, 30)) {
    issues.push({
      kind: "unused-param",
      severity: "info",
      title: `${s.name}() has ${s.unusedParams} unused parameter${s.unusedParams > 1 ? "s" : ""}`,
      filePath: s.filePath,
      symbolName: s.name,
    });
  }

  // ---- persist issues (replace analyzer-owned kinds) ----
  await db.issue.deleteMany({
    where: { projectId, kind: { in: ["broken-import", "circular-dep", "orphan-file", "dead-code", "duplicate", "near-duplicate", "missing-impl", "stub", "no-callers", "missing-tests", "unused-param"] } },
  });
  if (issues.length) {
    await db.issue.createMany({
      data: issues.map((i) => ({
        projectId,
        kind: i.kind,
        severity: i.severity,
        title: i.title.slice(0, 300),
        detail: i.detail || "{}",
        filePath: i.filePath || null,
        symbolName: i.symbolName || null,
        relatedPaths: JSON.stringify(i.relatedPaths || []),
      })),
    });
  }

  // ---- update project stats + health ----
  const fileStates = await db.fileState.count({ where: { projectId, deleted: false } });
  const openErrors = await db.errorEvent.count({ where: { projectId, status: { in: ["open", "recurring"] } } });
  const counts = {
    critical: issues.filter((i) => i.severity === "critical").length,
    warning: issues.filter((i) => i.severity === "warning").length,
    info: issues.filter((i) => i.severity === "info").length,
  };
  const health = Math.max(5, 100 - counts.critical * 8 - counts.warning * 3 - counts.info * 1 - openErrors * 4);
  await db.project.update({
    where: { id: projectId },
    data: { healthScore: health, fileCount: fileStates, lastScanAt: new Date() },
  });

  return { symbols: symbolRows.length, dependencies: depRows.length, issues: issues.length, cycles: cycles.length };
}

type symbolRowsType = {
  filePath: string; name: string; kind: string; isExported: boolean;
  startLine: number; endLine: number; paramCount: number; unusedParams: number;
  isStub: boolean; hasTodo: boolean; complexity: number; bodyHash: string; signature: string;
  callCount: number; isTested: boolean;
};

function cap<T>(arr: T[], n: number): T[] {
  return arr.slice(0, n);
}

function dice(a: Record<string, number>, b: Record<string, number>): number {
  let inter = 0;
  let total = 0;
  for (const [k, v] of Object.entries(a)) {
    total += v;
    if (b[k]) inter += Math.min(v, b[k]);
  }
  for (const v of Object.values(b)) total += v;
  return total === 0 ? 0 : (2 * inter) / total;
}

/** Recompute TODO issues (they come from any file type, not just analyzable code). */
export async function scanTodoIssues(projectId: string, rootPath: string): Promise<number> {
  const files = listProjectFiles(rootPath);
  const todos: { file: string; line: number; text: string }[] = [];
  for (const abs of files) {
    try {
      if (fs.statSync(abs).size > ENGINE_CONFIG.maxFileSize) continue;
      const content = fs.readFileSync(abs, "utf8");
      const rel = relPath(rootPath, abs);
      const lines = content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const m = /(?:\/\/|#|\/\*|<!--)\s*(TODO|FIXME)[:\s](.{3,150})/i.exec(lines[i]);
        if (m) todos.push({ file: rel, line: i + 1, text: `${m[1].toUpperCase()}: ${m[2].trim()}` });
      }
    } catch {
      // skip
    }
  }
  await db.issue.deleteMany({ where: { projectId, kind: "todo" } });
  if (todos.length) {
    await db.issue.createMany({
      data: cap(todos, 80).map((t) => ({
        projectId,
        kind: "todo",
        severity: "info",
        title: t.text.slice(0, 200),
        filePath: t.file,
        detail: JSON.stringify({ line: t.line }),
      })),
    });
  }
  return todos.length;
}
