## Beta 0.1.2

⚠️ Status: BETA — experimental and may be unstable.

## Improvements & Changes

- better playback stability and compatibility across webOS and Tizen

- parental guide, episode ratings, and skip intro support have been added to the detail experience

- improved trailer handling and fallback behavior on TV devices

- improved watched sync, episode watched state, and Continue Watching behavior
  - progress now behaves more reliably across playback and detail views
  - back flow and resume behavior are more consistent

- improved Home and navigation performance
  - faster and more reliable movement across home, detail, stream, sidebar, and player screens
  - restored modern homepage row scrolling

- improved playback detection for HLS sources
  - `/playlist` URLs now work even when they do not include query parameters

- improved settings UI
  - refined settings screen behavior
  - updated switch styling and visual polish

- added polling-related improvements for smoother runtime behavior

- fixed webOS Homebrew repository metadata
  - Homebrew Channel installs now validate correctly and work as expected

## Install

### TizenBrew

- Open TizenBrew on your Samsung TV
- Add the GitHub module `NuvioMedia/NuvioTVTizen`
- Launch Nuvio TV from your installed modules

### webOS Homebrew

- For direct `.ipk` install: open the latest release in `NuvioMedia/NuvioWeb`, download the attached `.ipk`, enable Developer Mode and Key Server by following `https://www.webosbrew.org/devmode`, then install it with `webOS Dev Manager`
- For Homebrew Channel repository install: open `Homebrew Channel`, go to `Settings`, choose `Add repository`, enter `https://raw.githubusercontent.com/NuvioMedia/NuvioWebOS/main/webosbrew/apps.json`, return to the apps list, and install Nuvio TV from there

Build - `0.1.2`
