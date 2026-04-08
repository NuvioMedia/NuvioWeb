import { cp, mkdir, readFile, rm, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { transformAsync } from "@babel/core";
import postcssGlobalData from '@csstools/postcss-global-data';
import postcss from 'postcss';
import cssnano from 'cssnano';
import autoprefixer from 'autoprefixer';
import postcssCustomProperties from 'postcss-custom-properties';
import esbuildBabel from '@chialab/esbuild-plugin-babel';
import { readAppMetadata, syncVersionFiles } from "./appMetadata.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const bundleFileName = "app.bundle.js";
const rootBundlePath = path.join(rootDir, bundleFileName);

const defaultEnvFileContents = `(function defineNuvioEnv() {
  var root = typeof globalThis !== "undefined" ? globalThis : window;
  root.__NUVIO_ENV__ = {
    SUPABASE_URL: "",
    SUPABASE_ANON_KEY: "",
    TV_LOGIN_REDIRECT_BASE_URL: "",
    YOUTUBE_PROXY_URL: "youtube-proxy.html",
    ADDON_REMOTE_BASE_URL: "",
    ENABLE_REMOTE_WRAPPER_MODE: false,
    PREFERRED_PLAYBACK_ORDER: ["native-hls", "hls.js", "dash.js", "native-file", "platform-avplay"],
    TMDB_API_KEY: ""
  };
}());
`;

async function buildCSS() {
  console.log("processing CSS with PostCSS (legacy upport)...");
  const cssDir = path.join(rootDir, "css");
  const files = await readdir(cssDir);
  const cssFiles = files.filter(f => f.endsWith(".css"));

  for (const file of cssFiles) {
    const cssPath = path.join(cssDir, file);
    const outPath = path.join(distDir, "css", file);

    const css = await readFile(cssPath, 'utf8');
    const result = await postcss([
      postcssGlobalData({ files: [path.join(cssDir, "base.css")] }),
      postcssCustomProperties({ preserve: false }), 
      autoprefixer({ overrideBrowserslist: ['Chrome 38'], grid: "autoplace" }),
      cssnano()
    ]).process(css, { from: cssPath, to: outPath });

    await mkdir(path.dirname(outPath), { recursive: true });
    await writeFile(outPath, result.css);
  }
}

async function copyOptionalRootFile(fileName, { fallback = null, defaultContents = defaultEnvFileContents } = {}) {
  const targetPath = path.join(distDir, fileName);
  try {
    await cp(path.join(rootDir, fileName), targetPath);
    return fileName;
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  if (!fallback) {
    return "";
  }

  try {
    await cp(path.join(rootDir, fallback), targetPath);
    return fallback;
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  await writeFile(targetPath, defaultContents, "utf8");
  return "generated-default";
}

async function buildBundle() {
  const { version } = await readAppMetadata();

  console.log("starting bundle build...");

  // create a temporary bundle for babel to process
  await build({
    entryPoints: [path.join(rootDir, "js/app.js")],
    outfile: rootBundlePath,
    bundle: true,
    format: "iife",
    target: ["es2015"], 
    define: { "process.env.NODE_ENV": '"production"', __NUVIO_APP_VERSION__: JSON.stringify(version) }
  });

  console.log("applying Babel transpilation...");
  const bundledCode = await readFile(rootBundlePath, "utf8");
  const babelResult = await transformAsync(bundledCode, {
    presets: [
      ["@babel/preset-env", {
        targets: "chrome 38",
        useBuiltIns: "entry", 
        corejs: 3,
      }]
    ],
    plugins: [
      // babel plugins
      "@babel/plugin-transform-runtime",
      "@babel/plugin-transform-optional-chaining",
      "@babel/plugin-transform-nullish-coalescing-operator"
    ],
    compact: true,
    minified: true
  });

  // save result back to the temporary bundle file (which will be the input for esbuild)
  await writeFile(rootBundlePath, babelResult.code, "utf8");

  // flattening
  // babel introduces some helper functions that are not tree-shakeable, so we need to bundle again with esbuild to flatten everything into a single file and remove any remaining unused code
  console.log("finalizing bundle with esbuild...");
  await build({
    entryPoints: [rootBundlePath],
    outfile: path.join(distDir, bundleFileName),
    bundle: true,
    minify: true,
    format: "iife",
    target: ["es5"],
    supported: {
      arrow: false,
      "const-and-let": false,
      "template-literal": false,
      "object-extensions": false
    }
  });

  await rm(rootBundlePath).catch(() => { });
  console.log("bundle build complete");
}

async function runBuild() {
  try {
    console.log("cleaning dist directory...");
    await rm(distDir, { recursive: true, force: true });
    await mkdir(distDir, { recursive: true });
    
    console.log("building version files...");
    await buildCSS();

    console.log("copying static assets...");
    await Promise.all([
      cp(path.join(rootDir, "assets"), path.join(distDir, "assets"), { recursive: true }),
      cp(path.join(rootDir, "res"), path.join(distDir, "res"), { recursive: true }),
      cp(path.join(rootDir, "appinfo.json"), path.join(distDir, "appinfo.json")),
      cp(path.join(rootDir, "docs", "youtube-proxy.html"), path.join(distDir, "youtube-proxy.html"))
    ]);

    // js bundle processing (final step to ensure all transformations are applied correctly and we end up with a single, minified bundle file)
    await buildBundle();

    const sourceIndex = await readFile(path.join(rootDir, "index.html"), "utf8");
    await writeFile(path.join(distDir, "index.html"), sourceIndex);

    console.log("configuring nuvio.env.js...");
    const copiedEnvSource = await copyOptionalRootFile("nuvio.env.js", {
      fallback: "nuvio.env.example.js"
    });

    if (copiedEnvSource === "nuvio.env.example.js") {
      console.warn("WARNING: using nuvio.env.example.js as fallback.");
    } else if (copiedEnvSource === "generated-default") {
      console.warn("WARNING: generated default nuvio.env.js (unconfigured).");
    }

    console.log(`\nbuild finished successfully in: ${distDir}`);
  } catch (error) {
    console.error("\nbuild failed:");
    console.error(error);
    process.exit(1); 
  }
}

runBuild();