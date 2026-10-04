#!/usr/bin/env node
// ============================================================
// 🏷️  Rebrand script — put YOUR name on this project.
//
// Usage:  npm run rebrand -- "Your Name" ["Author Name"]
//         bun  run rebrand -- "Your Name" ["Author Name"]
//
// Updates: src/lib/brand.config.ts, package.json, README.md
// ============================================================
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const name = process.argv[2];
if (!name) {
  console.error('\x1b[33mUsage:\x1b[0m npm run rebrand -- "Your Brand Name" ["author"]\n');
  console.error('Example: npm run rebrand -- "Sara Watch" "Sara"');
  process.exit(1);
}
const author = process.argv[3] || name;
const slug =
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || "agent-watch";

let touched = 0;

// 1) brand.config.ts
const brandFile = path.join(root, "src/lib/brand.config.ts");
if (fs.existsSync(brandFile)) {
  let src = fs.readFileSync(brandFile, "utf8");
  src = src.replace(/name: ".*"/, `name: "${name.replace(/"/g, '\\"')}"`);
  src = src.replace(/author: ".*"/, `author: "${author.replace(/"/g, '\\"')}"`);
  fs.writeFileSync(brandFile, src);
  touched++;
  console.log(`\x1b[32m✓\x1b[0m src/lib/brand.config.ts`);
}

// 2) package.json name
const pkgFile = path.join(root, "package.json");
if (fs.existsSync(pkgFile)) {
  const pkg = JSON.parse(fs.readFileSync(pkgFile, "utf8"));
  pkg.name = slug;
  fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + "\n");
  touched++;
  console.log(`\x1b[32m✓\x1b[0m package.json (name → ${slug})`);
}

// 3) README.md first heading
const readmeFile = path.join(root, "README.md");
if (fs.existsSync(readmeFile)) {
  let md = fs.readFileSync(readmeFile, "utf8");
  md = md.replace(/^# .+$/m, `# ${name}`);
  fs.writeFileSync(readmeFile, md);
  touched++;
  console.log(`\x1b[32m✓\x1b[0m README.md`);
}

console.log(`\n\x1b[36m${name}\x1b[0m is now the product name (${touched} files updated).`);
console.log("Restart the dev server and refresh the browser to see your branding everywhere.\n");
