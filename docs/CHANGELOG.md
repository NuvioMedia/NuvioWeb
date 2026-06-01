# Changelog

## 0.2.0

Yep, it's the finally here. The update you've all been waiting for. This is the biggest update we've released so far and the result of more than a month of work. With this release, the Web TV experience is now much closer to feature parity with the Android TV version, bringing many of the features and improvements you've been asking for. This isn't the end of Nuvio's development — it's just the beginning. New updates and releases will come much faster from here on out with all the improvements we've made. Thank you to everyone who tested builds, reported issues, and patiently waited for this release. That said, please keep in mind that Web TV is still in beta, so you may run into bugs and rough edges. If you do, we'd greatly appreciate you reporting them so we can continue improving the experience. We'd also love to hear about any features from the Android TV version that are still missing, as well as any completely new features you'd like to see across the Nuvio ecosystem. We hope you enjoy the update, and we're excited to hear what you think.

One more thing: below you'll find most of the changes included in this release (though I probably forgot a few of them 😅). One of the new additions is the Supporters & Contributors screen, which you can find under Settings → About → Supporters & Contributors. If you're enjoying Nuvio and would like to support its development, please consider donating to any of the developers listed there. Every contribution, no matter the size, helps support ongoing development and motivates us to continue building, maintaining, and improving Nuvio for everyone.

We also released a brand new Nuvio WebTV Installer that makes getting Nuvio on your TV much simpler. Whether you're installing Nuvio for the first time or updating from an older version, the installer helps streamline the process and reduces most of the manual setup steps. Make sure to check the installation instructions below for details on how to get started.

### Improvements & Changes

- refreshed the TV app presentation and navigation across the experience
  - updated sidebars, dialogs, filters, settings, profiles, and player overlays
  - refined home hero behavior, poster sizing, row movement, and route transitions
  - improved focus restoration and navigation consistency across TV screens

- improved profile and account flows
  - added a redesigned profile selection and profile editor experience for TV use
  - refined profile PIN entry, profile management, and editor focus behavior
  - added QR-based sign-in and addon phone activation flows
  - startup now handles profile selection and home reloads more consistently

- improved settings across appearance, layout, account, plugins, and playback
  - redesigned the settings page sizing, sidebar workspace, option cards, and dialogs
  - added expanded appearance controls, layout previews, and app-wide theme behavior
  - improved settings activation, back button behavior, scrolling, and focus restoration
  - simplified the plugins settings page and improved account sync status display

- added Trakt, library, and collection features
  - added a dedicated Trakt connection screen and Trakt settings layout
  - added collection folder home rows and collection detail screens
  - added personal list management, list dialogs, and Trakt list actions in Library
  - improved collection pagination, placeholders, episode loading, and route transitions

- improved Home, Discover, Search, and Detail screens
  - refined modern home hero transitions, row peeks, card sizing, and hold menus
  - added modern home fast scroll and improved scroll alignment
  - improved Discover filter focus, picker activation, route entry, and episode ratings
  - refined Detail screen focus behavior, episode cards, backdrop fade/shadow, and release dates
  - fixed Samsung search input and addon search target handling

- improved Continue Watching and watch-state behavior
  - refined continue watching cards and provider loading
  - improved next-up handling, watched-state sync, and settings for continue watching behavior
  - preserved hold-menu scroll state and home focus more reliably when returning to Home

- improved playback, player controls, and subtitles
  - refreshed player overlays, clock sizing, pause behavior, and control focus
  - fixed player scaling issues and improved Samsung player back-button behavior
  - improved subtitle retrieval on webOS and fixed expired-token subtitle failures
  - improved track extraction, stream handling, and player navigation on TV devices

- added a supporters and contributors screen
  - added the new supporters/contributors view
  - improved focus behavior on the supporters screen

- improved TV UI polish and responsive scaling
  - refined dialog sizing, screen scaling, hold-menu behavior, and animation timing
  - improved metadata presentation, card radius consistency, and responsive TV layout behavior
  - improved translations and missing i18n coverage across updated flows

- improved packaging, wrappers, and release distribution
  - added direct Tizen `.wgt` packaging from this repo
  - bumped app and webOS package metadata to `0.2.0`
  - improved wrapper syncing and webOS packaging behavior

## Install

Status: BETA - experimental and may be unstable.

### Nuvio WebTV Installer

- Download the latest Windows or macOS `Nuvio WebTV Installer` build from the latest `NuvioMedia/NuvioWeb` release
- Use it to install the latest `.wgt` and `.ipk` builds directly to supported Samsung Tizen and LG webOS TVs

### TizenBrew

- Open TizenBrew on your Samsung TV
- Add the GitHub module `NuvioMedia/NuvioTVTizen`
- Launch Nuvio TV from your installed modules

### webOS Homebrew

- For direct `.ipk` install: open the latest release in `NuvioMedia/NuvioWeb`, download the attached `.ipk`, enable Developer Mode and Key Server by following `https://www.webosbrew.org/devmode`, then install it with `webOS Dev Manager`
- For Homebrew Channel repository install: open `Homebrew Channel`, go to `Settings`, choose `Add repository`, enter `https://raw.githubusercontent.com/NuvioMedia/NuvioWebOS/main/webosbrew/apps.json`, return to the apps list, and install Nuvio TV from there
