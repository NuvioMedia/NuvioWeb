## Beta 0.1.3

⚠️ Status: BETA — experimental and may be unstable.

## Improvements & Changes

- better playback stability, player UX, and TV compatibility across webOS and Tizen
  - refined skip intro timing and Tizen audio behavior
  - improved responsive UI scaling and broader TV compatibility

- improved modern Home presentation
  - added modern landscape poster support
  - aligned the modern Home experience closer to Android TV
  - fixed focused landscape card expansion sizing and trailer autoplay behavior

- improved watched sync and resume reliability
  - fixed additional watch progress sync edge cases
  - reduced duplicate sync behavior between playback and resume flows

- improved Home performance and responsiveness on TV devices

- improved localization coverage with missing key fixes and translation updates

- improved release packaging automation for platform builds
  - Tizen wrapper versions now stay aligned with releases
  - webOS release builds now rebuild by default for fresher packaged artifacts

## Install

### TizenBrew

- Open TizenBrew on your Samsung TV
- Add the GitHub module `NuvioMedia/NuvioTVTizen`
- Launch Nuvio TV from your installed modules

### webOS Homebrew

- For direct `.ipk` install: open the latest release in `NuvioMedia/NuvioWeb`, download the attached `.ipk`, enable Developer Mode and Key Server by following `https://www.webosbrew.org/devmode`, then install it with `webOS Dev Manager`
- For Homebrew Channel repository install: open `Homebrew Channel`, go to `Settings`, choose `Add repository`, enter `https://raw.githubusercontent.com/NuvioMedia/NuvioWebOS/main/webosbrew/apps.json`, return to the apps list, and install Nuvio TV from there

Build - `0.1.3`
