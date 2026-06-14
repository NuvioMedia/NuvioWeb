import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readAppMetadata } from "./appMetadata.mjs";
import { runAresCli } from "./aresCli.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

function hasPackageArg(args) {
  return args.some((arg) => !arg.startsWith("-") && arg.endsWith(".ipk"));
}

async function resolveDefaultPackagePath() {
  const { version } = await readAppMetadata();
  const packagePath = path.join(rootDir, `space.nuvio.webos_${version}_all.ipk`);
  try {
    await access(packagePath, fsConstants.R_OK);
  } catch {
    throw new Error(`Package not found at ${packagePath}. Run "npm run package:webos" first.`);
  }
  return packagePath;
}

async function main() {
  const args = process.argv.slice(2);
  const installArgs = hasPackageArg(args)
    ? args
    : [await resolveDefaultPackagePath(), ...args];

  await runAresCli("ares-install", installArgs);
}

try {
  await main();
} catch (error) {
  console.error("\nwebOS install failed:");
  console.error(error);
  process.exit(1);
}
