import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { build, transform } from "esbuild";

export async function buildWebOsService({ sourceDir, targetDir, nodeVersion }) {
  const packageJson = JSON.parse(await readFile(path.join(sourceDir, "package.json"), "utf8"));
  const mediaRuntimeSource = await readFile(path.join(sourceDir, "runtime", "media-http.cjs"), "utf8");
  const mediaRuntime = await transform(mediaRuntimeSource, {
    loader: "js",
    target: "es2015",
    format: "cjs",
    minify: true,
    sourcemap: false
  });

  await rm(targetDir, { recursive: true, force: true });
  await mkdir(path.join(targetDir, "src"), { recursive: true });
  await mkdir(path.join(targetDir, "runtime"), { recursive: true });
  await Promise.all([
    writeFile(path.join(targetDir, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`, "utf8"),
    cp(path.join(sourceDir, "services.json"), path.join(targetDir, "services.json")),
    writeFile(
      path.join(targetDir, "runtime", "media-http.cjs"),
      mediaRuntime.code,
      "utf8"
    )
  ]);

  await build({
    entryPoints: [path.join(sourceDir, "src", "index.js")],
    outfile: path.join(targetDir, "src", "index.js"),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: [`node${nodeVersion}`],
    external: ["webos-service"],
    logLevel: "silent"
  });
}