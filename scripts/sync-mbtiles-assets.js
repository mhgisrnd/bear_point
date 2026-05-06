const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const sourcePath = path.join(projectRoot, "mbtiles", "korea-selection2-z7-z17-webp.mbtiles");
const targetDir = path.join(projectRoot, "public", "assets", "databases");
const targetPath = path.join(targetDir, "korea-selection2-z7-z17-webp.db");

function ensureDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function shouldCopy(sourceStat, targetStat) {
  if (!targetStat) return true;
  return sourceStat.size !== targetStat.size || sourceStat.mtimeMs > targetStat.mtimeMs;
}

if (!fs.existsSync(sourcePath)) {
  console.error("[MBTiles] source file not found:", sourcePath);
  process.exit(1);
}

ensureDirectory(targetDir);

const sourceStat = fs.statSync(sourcePath);
const targetStat = fs.existsSync(targetPath) ? fs.statSync(targetPath) : null;

if (shouldCopy(sourceStat, targetStat)) {
  fs.copyFileSync(sourcePath, targetPath);
  console.log("[MBTiles] copied asset DB:", targetPath);
} else {
  console.log("[MBTiles] asset DB already up to date:", targetPath);
}