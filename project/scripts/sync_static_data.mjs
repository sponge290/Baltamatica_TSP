import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..", "..");

const sourceDir = path.join(root, "project", "data");
const targetDir = path.join(root, "project", "frontend", "public", "data");
const files = [
  "cities.csv",
  "road_segments.csv",
  "test_cases.csv",
  "weather_observations.csv",
];

async function ensureUtf8NoBom(filePath) {
  const text = await readFile(filePath, "utf8");
  const normalized = text.replace(/^\uFEFF/, "");
  await writeFile(filePath, normalized, "utf8");
}

async function main() {
  await mkdir(targetDir, { recursive: true });

  for (const file of files) {
    const sourcePath = path.join(sourceDir, file);
    const targetPath = path.join(targetDir, file);
    await ensureUtf8NoBom(sourcePath);
    await cp(sourcePath, targetPath);
    await ensureUtf8NoBom(targetPath);
    console.log(`synced ${file}`);
  }
}

main().catch((err) => {
  console.error("sync failed:", err);
  process.exit(1);
});
