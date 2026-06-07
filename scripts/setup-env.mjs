// Copies server/.env.example -> server/.env on first setup (no overwrite).
// Cross-platform; runs via `npm run setup`.
import { copyFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const example = join(root, "server", ".env.example");
const target = join(root, "server", ".env");

if (existsSync(target)) {
  console.log("server/.env already exists — leaving it untouched.");
} else if (existsSync(example)) {
  copyFileSync(example, target);
  console.log("Created server/.env from .env.example — add your GOOGLE_API_KEY.");
} else {
  console.warn("server/.env.example not found; skipping .env creation.");
}
