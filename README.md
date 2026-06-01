<div align="center">

  <img src="https://github.com/tapframe/NuvioTV/raw/dev/assets/brand/app_logo_wordmark.png" alt="NuvioTV Web" width="300" />
  <br />
  <br />

  <p>
    A modern <b>web version</b> of Nuvio TV powered by the Stremio addon ecosystem.
    <br />
    Shared web app • TV packages • Desktop installer • Playback-focused experience
  </p>

  <p>
    ⚠️ <b>Status: BETA</b> — experimental and may be unstable.
  </p>

</div>

## About

**NuvioTV Web** is the shared web app source for the Nuvio TV experience. It runs in a browser and also powers TV builds for **Samsung Tizen** and **LG webOS**.

It acts as a client-side interface that can integrate with the **Stremio addon ecosystem** for content discovery and source resolution through user-installed extensions.

> This repository is the shared web codebase. It produces the TV release packages consumed by TizenBrew, webOS Homebrew, and the desktop `Nuvio WebTV Installer`.

## Install

### Nuvio WebTV Installer

- Download the latest Windows or macOS `Nuvio WebTV Installer` build from the latest `NuvioMedia/NuvioWeb` release
- The installer can connect to both Samsung Tizen and LG webOS TVs and install the latest `.wgt` and `.ipk` automatically

macOS note:
Current public macOS installer builds are unsigned. If macOS says the app is damaged or refuses to open it, move the app to `Applications` and run:

```bash
xattr -dr com.apple.quarantine "/Applications/Nuvio WebTV Installer.app"
codesign --force --deep --sign - "/Applications/Nuvio WebTV Installer.app"
open "/Applications/Nuvio WebTV Installer.app"
```

This workaround should only be temporary. Once signed macOS builds are included in a future release, this manual step should no longer be needed.

### TizenBrew

- Open TizenBrew on your Samsung TV
- Add the GitHub module `NuvioMedia/NuvioTVTizen`
- Launch Nuvio TV from your installed modules

### webOS Homebrew

- For Homebrew Channel repository install: open `Homebrew Channel`, go to `Settings`, choose `Add repository`, enter `https://raw.githubusercontent.com/NuvioMedia/NuvioWebOS/main/webosbrew/apps.json`, return to the apps list, and install Nuvio TV from there

### Platform Repositories

- TizenBrew wrapper: `NuvioMedia/NuvioTVTizen`
- webOS metadata repo: `NuvioMedia/NuvioWebOS`
- Desktop installer repo: `NuvioMedia/NuvioWebTVInstaller`

## Origins / Credits

This project is part of the Nuvio TV ecosystem and has two important roots:

- **tapframe/NuvioTV**  
  The original Android TV project that inspired the TV-first product direction.  
  https://github.com/tapframe/NuvioTV

- **WhiteGiso/NuvioTV-WebOS**  
  The community webOS codebase that served as the starting inspiration/base for this shared web version.  
  https://github.com/WhiteGiso/NuvioTV-WebOS

This repository expands on that foundation into a shared web app that can be reused across platforms.

## For Developers

### Repository Structure

- `js/` app logic, platform adapters, player code
- `css/` shared styling
- `assets/` icons, branding, bundled libs
- `scripts/` build and sync tooling for self-packaged wrappers
- `dist/` generated build output

### Run the Web App Locally

```bash
npm install
npm run build
python3 -m http.server 8080 -d dist
```

Open `http://127.0.0.1:8080`.

### Building Wrapper Projects Yourself

The public TizenBrew wrapper still points at the hosted web app. webOS release IPKs are now self-packaged from this repo, and the sync tooling remains available for developers who want custom packaged wrappers.

#### webOS self-packaged wrapper

Create a separate webOS project folder with at least:

```text
YourWebOSProject/
  appinfo.json
  index.html
  main.js
```

Then sync the built app into that wrapper:

```bash
npm run build
npm run sync:webos -- /absolute/path/to/YourWebOSProject
```

Package/install it with your normal webOS CLI workflow.

For a local IPK directly from this repo:

```bash
npm run package:webos
npm run install:webos -- -d lg
npm run inspect:webos -- -d lg
npm run logs:webos -- -d lg
```

#### Tizen self-packaged wrapper

Create a separate Tizen project folder with at least:

```text
YourTizenProject/
  config.xml
  index.html
  main.js
```

Then sync the built app into that wrapper:

```bash
npm run build
npm run sync:tizen -- /absolute/path/to/YourTizenProject
```

Package/install it with Tizen Studio or your normal Samsung TV workflow.

For a local WGT directly from this repo without opening Tizen Studio:

```bash
npm run package:tizen
```

That creates `NuvioTV_VERSION.wgt` in the repo root. The package uses:

- Tizen package id: `NuvioTV`
- Tizen application id: `NuvioTV.NuvioTV`
- bundled runtime env: your local `nuvio.env.js` copied by `npm run build`

Override these when needed:

```bash
TIZEN_PACKAGE_ID=NuvioTV TIZEN_APP_ID=NuvioTV.NuvioTV npm run package:tizen
```

To package a different env file explicitly:

```bash
npm run package:tizen -- --env-source /absolute/path/to/nuvio.env.js
```

### Sync Commands

```bash
npm run sync:webos -- /absolute/path/to/project
npm run sync:tizen -- /absolute/path/to/project
```

Compatibility form:

```bash
npm run sync -- --webos --path /absolute/path/to/project
npm run sync -- --tizen --path /absolute/path/to/project
```

### Hosted vs Packaged

- The shared app can be hosted as a normal website
- The maintained Tizen wrapper still launches the hosted app
- webOS release IPKs are built locally from this repo and published to `NuvioMedia/NuvioWeb` releases
- desktop installer builds can also be attached to `NuvioMedia/NuvioWeb` releases from `NuvioMedia/NuvioWebTVInstaller`
- The sync commands are for developers who want fully packaged custom wrappers

## Legal & Disclaimer

This project functions solely as a client-side interface for browsing metadata and playing media provided by user-installed extensions and/or user-provided sources.

It is intended for content the user owns or is otherwise authorized to access.

This project is not affiliated with third-party extensions or content providers and does not host, store, or distribute any media content.

## License

- Upstream Android TV project: see **tapframe/NuvioTV**
- Shared web / wrapper ecosystem: choose and document the final license for this repository
