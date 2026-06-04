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
const cacheDir = path.join(rootDir, ".cache");
const bundleFileName = "app.bundle.js";
const tempBundlePath = path.join(cacheDir, "__app.bundle.build.js");

const defaultEnvFileContents = `(function defineNuvioEnv() {
  var root = typeof globalThis !== "undefined" ? globalThis : window;
  root.__NUVIO_ENV__ = {
    SUPABASE_URL: "",
    SUPABASE_ANON_KEY: "",
    TV_LOGIN_REDIRECT_BASE_URL: "",
    YOUTUBE_PROXY_URL: "youtube-proxy.html",
    ADDON_REMOTE_BASE_URL: "",
    WEBOS_SERVICE_ID: "",
    ENABLE_REMOTE_WRAPPER_MODE: false,
    PREFERRED_PLAYBACK_ORDER: ["native-hls", "hls.js", "dash.js", "native-file", "platform-avplay"],
    TMDB_API_KEY: ""
  };
}());
`;

// Chrome 47 (Tizen 3.0) has no CSS custom properties. postcss-custom-properties only
// resolves :root vars; tokens scoped to a class (e.g. --legacy-sidebar-* on .home-shell)
// stay as var() and silently die on the TV. This plugin collects every `--name: value`
// declaration (from any selector, plus base.css) and substitutes var() globally.
// Safe here because tokens are static design values — no runtime theming (themes.css empty).
function resolveValue(value, map, depth = 0) {
  if (depth > 10 || value.indexOf("var(") === -1) return value;
  let out = "";
  let i = 0;
  while (i < value.length) {
    if (value.startsWith("var(", i)) {
      // find matching close paren
      let depthP = 0, j = i + 3;
      for (; j < value.length; j++) {
        if (value[j] === "(") depthP++;
        else if (value[j] === ")") { depthP--; if (depthP === 0) break; }
      }
      const inner = value.slice(i + 4, j); // between var( and )
      const comma = inner.indexOf(",");
      const name = (comma === -1 ? inner : inner.slice(0, comma)).trim();
      const fallback = comma === -1 ? null : inner.slice(comma + 1).trim();
      let repl;
      if (map[name] != null) repl = map[name];
      else if (fallback != null) repl = fallback;
      else repl = value.slice(i, j + 1); // leave intact for downstream
      out += resolveValue(repl, map, depth + 1);
      i = j + 1;
    } else {
      out += value[i++];
    }
  }
  return out;
}

// Chrome 47 (Tizen 3.0) has no CSS math functions clamp()/min()/max() (those are chrome 79+).
// calc() and var() are fine (var() is pre-inlined above). The TV renders at a fixed 1920x1080
// CSS viewport, so these resolve to a constant px value. This plugin inserts a resolved-px
// FALLBACK declaration *before* each clamp/min/max declaration — modern engines use the
// original (later) line, chrome 47 ignores it and uses the fallback. Safe for all platforms.
const VW = 1920 / 100, VH = 1080 / 100, REM = 16;
function lengthToPx(tok) {
  tok = tok.trim();
  let m;
  if ((m = tok.match(/^(-?[\d.]+)px$/))) return parseFloat(m[1]);
  if ((m = tok.match(/^(-?[\d.]+)vw$/))) return parseFloat(m[1]) * VW;
  if ((m = tok.match(/^(-?[\d.]+)vh$/))) return parseFloat(m[1]) * VH;
  if ((m = tok.match(/^(-?[\d.]+)vmin$/))) return parseFloat(m[1]) * Math.min(VW, VH);
  if ((m = tok.match(/^(-?[\d.]+)vmax$/))) return parseFloat(m[1]) * Math.max(VW, VH);
  if ((m = tok.match(/^(-?[\d.]+)rem$/))) return parseFloat(m[1]) * REM;
  if ((m = tok.match(/^(-?[\d.]+)$/))) return parseFloat(m[1]);
  return null; // %, em, auto, etc. — context-dependent, bail
}
function splitTopCommas(s) {
  const parts = []; let depth = 0, cur = "";
  for (const ch of s) {
    if (ch === "(") depth++; else if (ch === ")") depth--;
    if (ch === "," && depth === 0) { parts.push(cur); cur = ""; } else cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}
function evalMath(tok) {
  tok = tok.trim();
  let m;
  if ((m = tok.match(/^(clamp|min|max)\((.*)\)$/i))) {
    const fn = m[1].toLowerCase();
    const args = splitTopCommas(m[2]).map(evalMath);
    if (args.some((v) => v == null)) return null;
    if (fn === "min") return Math.min(...args);
    if (fn === "max") return Math.max(...args);
    return Math.min(Math.max(args[1], args[0]), args[2]); // clamp(min,val,max)
  }
  if (/^calc\(/i.test(tok)) return null; // calc works natively on chrome 47 — leave it
  return lengthToPx(tok);
}
function resolveMathFallback(value) {
  if (!/(clamp|min|max)\(/i.test(value)) return null;
  let out = "", i = 0, changed = false;
  while (i < value.length) {
    const rest = value.slice(i);
    const fm = rest.match(/^(clamp|min|max)\(/i);
    if (fm) {
      let depth = 0, j = i + fm[0].length - 1;
      for (; j < value.length; j++) { if (value[j] === "(") depth++; else if (value[j] === ")") { depth--; if (depth === 0) break; } }
      const call = value.slice(i, j + 1);
      const px = evalMath(call);
      if (px == null) return null; // unresolvable part -> skip whole declaration
      out += (Math.round(px * 100) / 100) + "px";
      changed = true;
      i = j + 1;
    } else { out += value[i++]; }
  }
  return changed ? out : null;
}
// chrome 47 has no `inset` shorthand (chrome 87+). Expand it to top/right/bottom/left
// longhands (emitted before the original so modern engines still see `inset`).
function expandInset() {
  return {
    postcssPlugin: "expand-inset",
    Declaration(decl) {
      if (decl.prop !== "inset") return;
      const p = decl.value.trim().split(/\s+/);
      let top, right, bottom, left;
      if (p.length === 1) { top = right = bottom = left = p[0]; }
      else if (p.length === 2) { top = bottom = p[0]; right = left = p[1]; }
      else if (p.length === 3) { top = p[0]; right = left = p[1]; bottom = p[2]; }
      else { top = p[0]; right = p[1]; bottom = p[2]; left = p[3]; }
      decl.cloneBefore({ prop: "top", value: top });
      decl.cloneBefore({ prop: "right", value: right });
      decl.cloneBefore({ prop: "bottom", value: bottom });
      decl.cloneBefore({ prop: "left", value: left });
    },
  };
}
expandInset.postcss = true;

function resolveViewportMath() {
  return {
    postcssPlugin: "resolve-viewport-math",
    Declaration(decl) {
      if (decl.value.indexOf("clamp(") === -1 && decl.value.indexOf("min(") === -1 && decl.value.indexOf("max(") === -1) return;
      if (decl.prop.startsWith("--")) return; // custom props already inlined
      const fallback = resolveMathFallback(decl.value);
      if (fallback && fallback !== decl.value) decl.cloneBefore({ value: fallback });
    },
  };
}
resolveViewportMath.postcss = true;

function inlineScopedVars(opts = {}) {
  return {
    postcssPlugin: "inline-scoped-vars",
    async Once(root, { result }) {
      const map = {};
      // seed from an extra defs file (base.css) so cross-file tokens resolve
      if (opts.extraDefs) {
        try {
          const { readFileSync } = await import("node:fs");
          const extra = readFileSync(opts.extraDefs, "utf8");
          const re = /(--[A-Za-z0-9_-]+)\s*:\s*([^;}]+)/g;
          let m;
          while ((m = re.exec(extra))) map[m[1]] = m[2].trim();
        } catch {}
      }
      root.walkDecls((d) => { if (d.prop.startsWith("--")) map[d.prop] = d.value.trim(); });
      // resolve nested var() inside the map itself
      for (const k of Object.keys(map)) map[k] = resolveValue(map[k], map);
      root.walkDecls((d) => {
        if (d.value.indexOf("var(") !== -1) d.value = resolveValue(d.value, map);
      });
    },
  };
}
inlineScopedVars.postcss = true;

async function buildCSS() {
  console.log("processing CSS with PostCSS (legacy support)...");
  const cssDir = path.join(rootDir, "css");
  const files = await readdir(cssDir);
  const cssFiles = files.filter(f => f.endsWith(".css"));

  for (const file of cssFiles) {
    const cssPath = path.join(cssDir, file);
    const outPath = path.join(distDir, "css", file);

    const css = await readFile(cssPath, 'utf8');
    const result = await postcss([
      inlineScopedVars({ extraDefs: path.join(cssDir, "base.css") }),
      expandInset(),
      resolveViewportMath(),
      postcssGlobalData({ files: [path.join(cssDir, "base.css")] }),
      postcssCustomProperties({ preserve: false }),
      autoprefixer({ overrideBrowserslist: ['Chrome 38'], grid: "autoplace" }),
      cssnano({ preset: ["default", { mergeLonghand: false }] })
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
  await mkdir(cacheDir, { recursive: true });

  // create a temporary bundle for babel to process
  await build({
    entryPoints: [path.join(rootDir, "js/app.js")],
    outfile: tempBundlePath,
    bundle: true,
    format: "iife",
    target: ["es2015"], 
    define: { "process.env.NODE_ENV": '"production"', __NUVIO_APP_VERSION__: JSON.stringify(version) }
  });

  console.log("applying Babel transpilation...");
  const bundledCode = await readFile(tempBundlePath, "utf8");
  const babelResult = await transformAsync(bundledCode, {
    presets: [
      ["@babel/preset-env", {
        targets: "chrome 38",
        useBuiltIns: "usage",
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
  await writeFile(tempBundlePath, babelResult.code, "utf8");

  // flattening
  // babel introduces some helper functions that are not tree-shakeable, so we need to bundle again with esbuild to flatten everything into a single file and remove any remaining unused code
  console.log("finalizing bundle with esbuild...");
  await build({
    entryPoints: [tempBundlePath],
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

  await cp(path.join(distDir, bundleFileName), path.join(rootDir, bundleFileName));
  await rm(tempBundlePath).catch(() => { });
  console.log("bundle build complete");
}
async function runBuild() {
  try {
    console.log("cleaning dist directory...");
    await rm(distDir, { recursive: true, force: true });
    await mkdir(distDir, { recursive: true });
    
    console.log("building version files...");
    await syncVersionFiles();
    await buildCSS();

    console.log("copying static assets...");
    const copiedAppInfoSource = await copyOptionalRootFile("appinfo.json");
    await Promise.all([
      cp(path.join(rootDir, "assets"), path.join(distDir, "assets"), { recursive: true }),
      cp(path.join(rootDir, "res"), path.join(distDir, "res"), { recursive: true }),
      cp(path.join(rootDir, "docs", "youtube-proxy.html"), path.join(distDir, "youtube-proxy.html"))
    ]);

    if (!copiedAppInfoSource) {
      console.warn("WARNING: skipping appinfo.json because it is not present in the repo root.");
    }

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
