<div align="center">

  <img src="https://github.com/tapframe/NuvioTV/raw/dev/assets/brand/app_logo_wordmark.png" alt="NuvioTV Web" width="300" />
  <br />
  <br />

  <p>
    A modern <b>web version</b> of Nuvio TV powered by the Stremio addon ecosystem.
    <br />
    Shared web app • TV wrapper ready • Playback-focused experience
  </p>

  <p>
    ⚠️ <b>Status: BETA</b> — experimental and may be unstable.
  </p>

</div>

## About

**NuvioTV Web** is the shared web app source for the Nuvio TV experience. It runs in a browser and can also be packaged inside TV wrapper projects such as **LG webOS** and **Samsung Tizen**.

It acts as a client-side interface that can integrate with the **Stremio addon ecosystem** for content discovery and source resolution through user-installed extensions.

> This repository is the shared web codebase, not the wrapper project itself.

## Origins / Credits

This project is part of the Nuvio TV ecosystem and has two important roots:

- **tapframe/NuvioTV**  
  The original Android TV project that inspired the TV-first product direction.  
  https://github.com/tapframe/NuvioTV

- **WhiteGiso/NuvioTV-WebOS**  
  The community webOS codebase that served as the starting inspiration/base for this shared web version.
  https://github.com/WhiteGiso/NuvioTV-WebOS

This repository expands on that foundation into a shared web app that can be reused across platforms.

## Repository Structure

- `js/` app logic, platform adapters, player code
- `css/` shared styling
- `assets/` icons, branding, bundled libs
- `scripts/` build and sync tooling
- `dist/` generated build output

## Development

### Prerequisites

- Node.js
- Python 3 for a simple local static server
- webOS CLI if you want to package/test on LG
- Tizen Studio if you want to package/test on Samsung

### Run the Web App Locally

```bash
npm install
npm run build
python3 -m http.server 8080 -d dist
```

Open `http://127.0.0.1:8080`.

## Creating a webOS Wrapper Project

Create a separate webOS project folder with at least:

```text
YourWebOSProject/
  appinfo.json
  index.html
  main.js
```

Recommended files:

- `appinfo.json`: webOS app metadata
- `index.html`: loads the shared app assets
- `main.js`: optional webOS bootstrap logic

For full webOS platform support, also include LG platform scripts in the wrapper project, especially if you want app exit handling or AVPlay integration.

Minimal packaged `index.html` example:

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>Nuvio TV</title>
  <link rel="stylesheet" href="css/base.css" />
  <link rel="stylesheet" href="css/layout.css" />
  <link rel="stylesheet" href="css/components.css" />
  <link rel="stylesheet" href="css/themes.css" />
</head>
<body>
  <script>window.__NUVIO_PLATFORM__ = "webos";</script>
  <script src="js/runtime/env.js"></script>
  <script src="webOSTVjs-1.2.12/webOSTV.js"></script>
  <script defer src="app.bundle.js"></script>
</body>
</html>
```

After that, sync the shared web build into the wrapper:

```bash
npm run build
npm run sync:webos -- /absolute/path/to/YourWebOSProject
```

Then package/install that wrapper with your normal webOS CLI workflow.

## Creating a Tizen Wrapper Project

Create a separate Tizen project folder with at least:

```text
YourTizenProject/
  config.xml
  index.html
  main.js
```

Recommended files:

- `config.xml`: Tizen app manifest
- `index.html`: loads wrapper bootstrap and shared assets
- `main.js`: registers TV keys and loads the bundled app

Minimal `index.html` example:

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>Nuvio TV Tizen</title>
  <link rel="stylesheet" href="css/base.css" />
  <link rel="stylesheet" href="css/layout.css" />
  <link rel="stylesheet" href="css/components.css" />
  <link rel="stylesheet" href="css/themes.css" />
</head>
<body>
  <script src="js/runtime/env.js"></script>
  <script defer src="main.js"></script>
</body>
</html>
```

Minimal `main.js` example:

```js
window.__NUVIO_PLATFORM__ = "tizen";

var tvInput = window.tizen && window.tizen.tvinputdevice;
if (tvInput && typeof tvInput.registerKey === "function") {
  ["MediaPlay", "MediaPause", "MediaPlayPause", "MediaFastForward", "MediaRewind"]
    .forEach(function registerKey(keyName) {
      try {
        tvInput.registerKey(keyName);
      } catch (_) {}
    });
}

var script = document.createElement("script");
script.src = "./app.bundle.js";
script.defer = true;
document.body.appendChild(script);
```

Then sync the shared web build into the wrapper:

```bash
npm run build
npm run sync:tizen -- /absolute/path/to/YourTizenProject
```

Then package/install that wrapper with Tizen Studio or your normal Samsung TV workflow.

## Sync Command

The universal sync command copies the built web app into a wrapper project:

```bash
npm run sync:webos -- /absolute/path/to/project
npm run sync:tizen -- /absolute/path/to/project
```

Compatibility form:

```bash
npm run sync -- --webos --path /absolute/path/to/project
npm run sync -- --tizen --path /absolute/path/to/project
```

It syncs:

- `assets/`
- `css/`
- `js/`
- `res/`
- `app.bundle.js`

It also updates wrapper metadata:

- `appinfo.json` for webOS: sets the title to `Nuvio TV`, points `icon` to `icon.png`, and points `largeIcon` to `largeIcon.png`
- `config.xml` for Tizen: sets `<name>` to `Nuvio TV` and `<icon src="icon.png"/>`
- copies `icon.png` into both wrapper roots and `largeIcon.png` into the webOS wrapper root

## Hosted vs Packaged

- This repo can be hosted as a normal website.
- TV wrappers can either package the synced build locally or redirect to a hosted URL.
- The sync command is for packaged-wrapper workflows.

## Legal & Disclaimer

This project functions solely as a client-side interface for browsing metadata and playing media provided by user-installed extensions and/or user-provided sources.

It is intended for content the user owns or is otherwise authorized to access.

This project is not affiliated with third-party extensions or content providers and does not host, store, or distribute any media content.

## License

- Upstream Android TV project: see **tapframe/NuvioTV**
- Shared web / wrapper ecosystem: choose and document the final license for this repository
