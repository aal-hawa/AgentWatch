// Content-addressable blob storage + shared DB helpers.
import crypto from "crypto";
import path from "path";
import { db } from "@/lib/db";

export function hashContent(content: string): string {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex").slice(0, 40);
}

/** Store content, return its hash. Deduped by hash. */
export async function putBlob(content: string): Promise<string> {
  const hash = hashContent(content);
  await db.blob.upsert({
    where: { hash },
    update: {},
    create: { hash, content, size: Buffer.byteLength(content, "utf8") },
  });
  return hash;
}

export async function getBlob(hash: string | null | undefined): Promise<string | null> {
  if (!hash) return null;
  const blob = await db.blob.findUnique({ where: { hash } });
  return blob?.content ?? null;
}

export async function getBlobs(hashes: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!hashes.length) return map;
  const rows = await db.blob.findMany({ where: { hash: { in: hashes } } });
  for (const r of rows) map.set(r.hash, r.content);
  return map;
}

export function relPath(rootPath: string, absPath: string): string {
  return path.relative(rootPath, absPath).split(path.sep).join("/");
}

export function absPath(rootPath: string, rel: string): string {
  return path.join(rootPath, ...rel.split("/"));
}

/** Normalize function body for exact-duplicate detection: strip comments/whitespace. */
export function normalizeBody(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Token multiset for near-duplicate similarity (Jaccard). */
export function tokenSignature(src: string): Record<string, number> {
  const tokens = src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/["'`]/g, " ")
    .split(/[^A-Za-z0-9_$]+/)
    .filter((t) => t.length > 1);
  const bag: Record<string, number> = {};
  for (const t of tokens) bag[t] = (bag[t] || 0) + 1;
  return bag;
}

export function jaccard(a: Record<string, number>, b: Record<string, number>): number {
  let inter = 0;
  let total = 0;
  for (const [k, v] of Object.entries(a)) {
    total += v;
    if (b[k]) inter += Math.min(v, b[k]);
  }
  for (const v of Object.values(b)) total += v;
  return total === 0 ? 0 : (2 * inter) / total; // Dice coefficient
}
