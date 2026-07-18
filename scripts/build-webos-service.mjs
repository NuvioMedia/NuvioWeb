import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { transformFile } from "@swc/core";
import { build } from "esbuild";

function lowerMediaRuntimeLookbehind(code) {
  const lowered = code.replace(
    "var episodeMatch=x.match(/(?<=\\W|\\d)E(\\d{2})/gi);episodeMatch&&(meta.episode=episodeMatch.map(function(y){return parseInt(y.slice(1),10)}));",
    "var episodeMatch=[];for(var episodeIndex=1;episodeIndex<x.length-2;episodeIndex++){var episodePrefix=x.charAt(episodeIndex-1),episodeToken=x.slice(episodeIndex,episodeIndex+3);(/[^A-Za-z_]|\\d/.test(episodePrefix)&&/^E\\d{2}$/i.test(episodeToken))&&episodeMatch.push(parseInt(episodeToken.slice(1),10))}episodeMatch.length&&(meta.episode=episodeMatch);"
  );
  if (lowered === code || lowered.includes("(?<=")) {
    throw new Error("Could not lower the media runtime lookbehind expression for Node 6.");
  }
  return lowered;
}

export async function buildWebOsService({ sourceDir, targetDir, nodeVersion }) {
  const packageJson = JSON.parse(await readFile(path.join(sourceDir, "package.json"), "utf8"));
  const mediaRuntime = await transformFile(path.join(sourceDir, "runtime", "media-http.cjs"), {
    jsc: {
      parser: { syntax: "ecmascript" },
      target: "es2015"
    },
    minify: true,
    module: { type: "commonjs" },
    sourceMaps: false
  });

  await rm(targetDir, { recursive: true, force: true });
  await mkdir(path.join(targetDir, "src"), { recursive: true });
  await mkdir(path.join(targetDir, "runtime"), { recursive: true });
  await Promise.all([
    writeFile(path.join(targetDir, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`, "utf8"),
    cp(path.join(sourceDir, "services.json"), path.join(targetDir, "services.json")),
    writeFile(
      path.join(targetDir, "runtime", "media-http.cjs"),
      lowerMediaRuntimeLookbehind(mediaRuntime.code),
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