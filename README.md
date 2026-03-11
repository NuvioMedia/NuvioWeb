<div align="center">

  <img src="https://github.com/tapframe/NuvioTV/raw/dev/assets/brand/app_logo_wordmark.png" alt="NuvioTV webOS" width="300" />
  <br />
  <br />

  <p>
    A modern <b>LG webOS</b> media player powered by the Stremio addon ecosystem.
    <br />
    Stremio Addon ecosystem • webOS optimized • Playback-focused experience
  </p>

  <p>
    ⚠️ <b>Status: BETA</b> — experimental and may be unstable.
  </p>

</div>

## About

**NuvioTV webOS** is an experimental LG webOS TV client focused on playback and TV-first navigation.

It acts as a client-side interface that can integrate with the **Stremio addon ecosystem** for content discovery and source resolution through user-installed extensions.

> This repository is a **separate webOS-focused codebase** (HTML/CSS/JS) and is **not** the Android TV app.

## Upstream / Credits (Thank you tapframe)

This project is a webOS port / re-implementation inspired by the original Android TV project:

- **tapframe/NuvioTV** (Official Android TV Repository)  
  https://github.com/tapframe/NuvioTV :contentReference[oaicite:1]{index=1}

All credits for the original Android TV implementation go to **tapframe** and contributors.  
This webOS version is **not affiliated** with tapframe and is provided as an independent community effort.

## Installation (LG webOS)

⚠️ **Status: Beta**  
This project is currently in early beta. Builds may be unstable or incomplete.

### Download

Precompiled `.ipk` packages will be available in the **Releases** section of this repository:

👉 https://github.com/WhiteGiso/NuvioTV-WebOS/releases

Download the latest `.ipk` file compatible with your webOS TV.

---

### Installing on LG webOS TV (Developer Mode)

To install the application on your LG TV, you must enable **Developer Mode**.

#### 1️⃣ Install the Developer Mode App

On your LG TV:

1. Open the **LG Content Store**
2. Search for **"Developer Mode"**
3. Install the official *Developer Mode* app by LG
4. Launch it and log in with your LG developer account  
   (You can create one at https://webostv.developer.lge.com/)

#### 2️⃣ Enable Developer Mode

Inside the Developer Mode app:

- Enable **Developer Mode**
- Enable **Key Server**
- Note your TV's **IP Address**
- Restart the TV when prompted

---

#### 3️⃣ Install the IPK Package

Using your computer:

1. Install the **webOS TV CLI** from LG
2. Connect your TV:
   ```bash
   ares-setup-device
3. Install the app:
   ```bash
   ares-install NuvioTV_webOS.ipk

Typical webOS development workflow uses `appinfo.json` in the app root. :contentReference[oaicite:2]{index=2}

## Development (LG webOS)

### Prerequisites
- webOS TV CLI / SDK
- A webOS TV device in Developer Mode (or emulator)

### Run locally
- Is needed `index.html` with a local web server and test in browser first
- Then package and install to webOS TV (documentation links in `/docs` or README updates)

## Legal & Disclaimer

This project functions solely as a client-side interface for browsing metadata and playing media provided by user-installed extensions and/or user-provided sources.  
It is intended for content the user owns or is otherwise authorized to access.

This project is not affiliated with third-party extensions or content providers and does not host, store, or distribute any media content.

(For the upstream Android TV project legal page, see tapframe/NuvioTV.) :contentReference[oaicite:3]{index=3}

## License

- Upstream Android TV project: see **tapframe/NuvioTV** repository license. :contentReference[oaicite:4]{index=4}
- This webOS repository: **(choose and state your license here)**  
  - If you include upstream code/assets: keep GPL-3.0 compatibility.
  - If it’s a clean-room re-implementation: you may choose another license, while still keeping proper attribution.

<!-- MARKDOWN LINKS & IMAGES -->
<!-- TODO: replace YOUR_GITHUB_USER and YOUR_REPO with your actual repo -->
[contributors-shield]: https://img.shields.io/github/contributors/YOUR_GITHUB_USER/YOUR_REPO.svg?style=for-the-badge
[contributors-url]: https://github.com/YOUR_GITHUB_USER/YOUR_REPO/graphs/contributors
[forks-shield]: https://img.shields.io/github/forks/YOUR_GITHUB_USER/YOUR_REPO.svg?style=for-the-badge
[forks-url]: https://github.com/YOUR_GITHUB_USER/YOUR_REPO/network/members
[stars-shield]: https://img.shields.io/github/stars/YOUR_GITHUB_USER/YOUR_REPO.svg?style=for-the-badge
[stars-url]: https://github.com/YOUR_GITHUB_USER/YOUR_REPO/stargazers
[issues-shield]: https://img.shields.io/github/issues/YOUR_GITHUB_USER/YOUR_REPO.svg?style=for-the-badge
[issues-url]: https://github.com/YOUR_GITHUB_USER/YOUR_REPO/issues
[license-shield]: https://img.shields.io/github/license/YOUR_GITHUB_USER/YOUR_REPO.svg?style=for-the-badge
[license-url]: ./LICENSE