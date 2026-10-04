// Engine configuration: ignore rules, limits, timing.
import path from "path";

export const ENGINE_CONFIG = {
  /** Debounce window before a batch of file events becomes a snapshot */
  debounceMs: 3000,
  /** Analysis debounce after changes (let snapshots settle first) */
  analysisDebounceMs: 2500,
  /** Files larger than this are not stored as blobs */
  maxFileSize: 512 * 1024,
  /** A batch with >= this many changed files is promoted to a milestone snapshot */
  milestoneFiles: 6,
  /** A batch with >= this many changed files is a semantic checkpoint */
  semanticFiles: 2,
  /** Max captured output per command (chars) */
  maxTerminalBuffer: 200_000,
  /** Command capture timeout (ms) */
  commandTimeoutMs: 10 * 60 * 1000,
  /** Max issues stored per analysis per kind (prevents flooding) */
  maxIssuesPerKind: 60,
} as const;

const IGNORE_DIRS = [
  "node_modules",
  ".git",
  ".next",
  ".turbo",
  ".cache",
  ".vercel",
  "dist",
  "build",
  "out",
  "coverage",
  ".nuxt",
  ".svelte-kit",
  "venv",
  ".venv",
  "__pycache__",
  ".agentwatch",
];

const IGNORE_EXT = new Set([
  // binary / assets
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".bmp", ".svgz",
  ".pdf", ".zip", ".gz", ".tar", ".rar", ".7z",
  ".woff", ".woff2", ".ttf", ".otf", ".eot",
  ".mp3", ".mp4", ".mov", ".avi", ".webm", ".wav",
  ".db", ".sqlite", ".sqlite3", ".db-journal", ".wasm",
  ".lock", ".bin", ".exe", ".dll", ".so", ".dylib", ".pyc", ".class",
]);

const IGNORE_FILES = new Set([
  ".DS_Store",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lock",
  "bun.lockb",
]);

const TEXT_CODE_EXT = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts",
  ".json", ".md", ".mdx", ".css", ".scss", ".less", ".html", ".htm",
  ".yml", ".yaml", ".toml", ".env", ".txt", ".prisma", ".graphql", ".gql",
  ".py", ".rb", ".go", ".rs", ".java", ".kt", ".php", ".c", ".h", ".cpp", ".cs",
  ".sh", ".bash", ".zsh", ".sql", ".vue", ".svelte", ".astro",
]);

export function isIgnoredPath(absPath: string, rootPath: string): boolean {
  const rel = path.relative(rootPath, absPath);
  // the root itself must be watchable — never ignore it
  if (!rel) return false;
  if (rel.startsWith("..") || path.isAbsolute(rel)) return true;
  const segments = rel.split(path.sep);
  for (const seg of segments) {
    if (IGNORE_DIRS.includes(seg)) return true;
  }
  const base = path.basename(absPath);
  if (IGNORE_FILES.has(base)) return true;
  // skip secret files (never store secrets in blobs)
  if (base.startsWith(".env")) return true;
  const ext = path.extname(base).toLowerCase();
  if (ext && IGNORE_EXT.has(ext)) return true;
  return false;
}

export function isWatchableFile(absPath: string, rootPath: string): boolean {
  if (isIgnoredPath(absPath, rootPath)) return false;
  const ext = path.extname(absPath).toLowerCase();
  // files without extension (Dockerfile, Makefile, LICENSE...) are watchable if small text
  if (!ext) return true;
  return TEXT_CODE_EXT.has(ext);
}

/** Extensions the AST analyzer understands deeply */
export const ANALYZABLE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

export function isAnalyzableFile(absPath: string): boolean {
  const ext = path.extname(absPath).toLowerCase();
  return ANALYZABLE_EXT.has(ext);
}

export const SEVERITY_COLORS: Record<string, string> = {
  critical: "#f87171",
  warning: "#fbbf24",
  info: "#67e8f9",
};
