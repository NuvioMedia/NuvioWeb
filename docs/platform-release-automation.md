# Platform Release Automation

This repo stays the source of truth for the shared web app. The private webOS wrapper repository builds from tagged releases in this repo and uploads the `.ipk` back to the matching GitHub release here.

TizenBrew no longer uses release dispatch from this repo. The public module lives in `NuvioMedia/NuvioTVTizen` and is consumed directly by TizenBrew.

## webOS

- Create a private GitHub repository for the local folder `/Users/edin/Documents/NuvioTV/NuvioWebOS`.
- Add the repository name to the `WEBOS_REPO` GitHub Actions variable in this repo, for example `your-org/NuvioWebOS`.
- Add a `REPO_DISPATCH_TOKEN` secret in this repo with permission to trigger workflows in that private repository.
- When a release is published here, `.github/workflows/release-platform-artifacts.yml` dispatches a `build-release` event to the private repository.
- The private repository checks out this repo at the release tag, runs `npm ci` and `npm run build`, then runs `npm run sync:webos -- --path <wrapper-repo-root>` against the checked out source.
- The private repository packages the wrapper with `ares-package` and uploads the generated `.ipk` back to the same release in this repo.

## Private Repository Secrets

Each private platform repository should define:

- `MAIN_REPO_RELEASE_TOKEN`: token with `contents: write` access to this repo so the workflow can upload assets to releases.

## Local Test Flow

From this repo you can generate the webOS wrapper contents locally:

```bash
npm install
npm run build
npm run sync:webos -- /Users/edin/Documents/NuvioTV/NuvioWebOS
```

That writes the built app into the private wrapper repository and refreshes `index.html`, `appinfo.json`, and the wrapper icons there.
