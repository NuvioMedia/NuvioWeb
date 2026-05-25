## Beta 0.1.5

⚠️ Status: BETA — experimental and may be unstable.

## Improvements & Changes

- added local media support for webOS and Tizen
  - embedded subtitle and audio tracks can now be discovered from local media sources
- improved playback, library, and metadata behavior on TV devices
  - refined player responsiveness, continue watching logic, parental guide handling, forced subtitles, and library flows
  - trailer handling and player back-button behavior are more consistent during TV usage
- improved wrapper compatibility and release tooling
  - added the webOS brew adapter and merged older webOS support work
  - release poller and platform build tooling have been updated for cleaner release deployment flows

## Install

### TizenBrew

- Open TizenBrew on your Samsung TV
- Add the GitHub module `NuvioMedia/NuvioTVTizen`
- Launch Nuvio TV from your installed modules

### webOS Homebrew

- For direct `.ipk` install: open the latest release in `NuvioMedia/NuvioWeb`, download the attached `.ipk`, enable Developer Mode and Key Server by following `https://www.webosbrew.org/devmode`, then install it with `webOS Dev Manager`
- For Homebrew Channel repository install: open `Homebrew Channel`, go to `Settings`, choose `Add repository`, enter `https://raw.githubusercontent.com/NuvioMedia/NuvioWebOS/main/webosbrew/apps.json`, return to the apps list, and install Nuvio TV from there

Build - `4b0c525`
