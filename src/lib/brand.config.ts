// ============================================================
// 🏷️  BRAND CONFIGURATION — THE ONLY PLACE TO CHANGE THE NAME
//
// Run:  npm run rebrand -- "Your Name"   (or: bun run rebrand -- "Your Name")
// This file, package.json and README.md will be updated for you.
// ============================================================

export const BRAND = {
  name: "Agent Watch",
  shortName: "AW",
  tagline:
    "The read-only AI agent that watches, remembers, analyzes, and maps everything your AI agents build.",
  author: "Agent Watch",
  version: "1.0.0",
} as const;

export type Brand = typeof BRAND;
