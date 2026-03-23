# Platform Release Automation

This repo stays the source of truth for the shared web app. On each published release, it bumps the public Tizen wrapper version and dispatches the private webOS wrapper repository so it can package a fresh `.ipk` and upload it back to the matching GitHub release here.

`NuvioMedia/NuvioTVTizen` is a lightweight hosted-site wrapper that users install directly in TizenBrew.

## TizenBrew

- Add the public module repository name to the `TIZEN_REPO` GitHub Actions variable in this repo, for example `your-org/NuvioTVTizen`.
- Add a `REPO_DISPATCH_TOKEN` secret in this repo with permission to push commits to that repository.
- When a release is published here, `.github/workflows/release-platform-artifacts.yml` updates `package.json` in the Tizen wrapper repository so the TizenBrew version matches the release tag.

## webOS

- Create a private GitHub repository for the local folder `/Users/edin/Documents/NuvioTV/NuvioWebOS`.
- Add the repository name to the `WEBOS_REPO` GitHub Actions variable in this repo, for example `your-org/NuvioWebOS`.
- Add a `REPO_DISPATCH_TOKEN` secret in this repo with permission to trigger workflows in that private repository.
- When a release is published here, `.github/workflows/release-platform-artifacts.yml` dispatches a `build-release` event to the private repository.
- By default the private repository reuses the previously packaged webOS `.ipk` and re-attaches it to the new release.
- If a release body contains `[rebuild-webos-ipk]`, the workflow updates the wrapper version from the release tag, packages the hosted-site launcher with `ares-package`, uploads the generated `.ipk`, and refreshes the Homebrew repository metadata.

## Private Repository Secrets

Each private platform repository should define:

- `MAIN_REPO_RELEASE_TOKEN`: token with `contents: write` access to this repo so the workflow can upload assets to releases.

## Local Test Flow

From this repo you can generate a fully packaged webOS wrapper project locally:

```bash
npm install
npm run build
npm run sync:webos -- /Users/edin/Documents/NuvioTV/NuvioWebOS
```

That writes a packaged build into your custom wrapper project. The maintained `NuvioWebOS` repository stays as a lightweight hosted-site launcher.
