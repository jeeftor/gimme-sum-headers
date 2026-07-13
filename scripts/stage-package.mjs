import { copyFile, mkdir, rm, stat, utimes } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

const [destination, ...files] = process.argv.slice(2);
const minimumZipTimestamp = 315532800;

if (!destination || files.length === 0) {
  throw new Error("Usage: node scripts/stage-package.mjs <destination> <file> [...file]");
}

const sourceDateEpoch = Number.parseInt(process.env.SOURCE_DATE_EPOCH ?? "", 10);

if (!Number.isInteger(sourceDateEpoch) || sourceDateEpoch < minimumZipTimestamp) {
  throw new Error("SOURCE_DATE_EPOCH must be an integer Unix timestamp on or after 1980-01-01.");
}

const sourceRoot = resolve(process.cwd());
const stageRoot = resolve(destination);

await rm(stageRoot, { force: true, recursive: true });
await mkdir(stageRoot, { recursive: true });

for (const file of files) {
  if (isAbsolute(file) || file === ".." || file.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) {
    throw new Error(`Package path must remain inside the source tree: ${file}`);
  }

  const sourcePath = resolve(sourceRoot, file);
  const targetPath = resolve(stageRoot, file);

  if (relative(sourceRoot, sourcePath).startsWith("..") || relative(stageRoot, targetPath).startsWith("..")) {
    throw new Error(`Package path escapes its root: ${file}`);
  }

  if (!(await stat(sourcePath)).isFile()) {
    throw new Error(`Package input is not a file: ${file}`);
  }

  await mkdir(dirname(targetPath), { recursive: true });
  await copyFile(sourcePath, targetPath);
  await utimes(targetPath, sourceDateEpoch, sourceDateEpoch);
}
