# v1.0.0 release pipeline: publish the Suite image to GHCR

## Context

The Suite ships today only as source: the bundled `docker-compose.yml` uses
`build: .`, with a commented-out `image: ghcr.io/x3n0n10/stream-share-suite:latest`
pointing at an image that does not exist yet. There are no git tags and no
release process. The sibling project, `stream-share` (Go), already publishes a
multi-arch image to GHCR on every `v*` tag, via GoReleaser, plus a manual
`dev-build.yml` for unreleased test images. This spec brings the Suite to the
same point for a v1.0.0 release.

GoReleaser is Go-specific and does not apply here. The Suite is a Node app whose
`Dockerfile` is already a complete multi-stage build (no native compilation,
alpine base), so the pipeline is plain Docker tooling.

## Scope

**In scope:** a tag-triggered release workflow, a manual dev-build workflow,
and the small repo changes that make v1.0.0 pullable.

**Out of scope:** showing the version in the UI or `/healthz`, a changelog
file (release notes are generated), image signing or SBOM, auto-tagging on
merge, and any change to the existing `ci.yml`.

## Approach

One job builds both platforms with QEMU emulation and Buildx
(`docker/build-push-action`). A native arm64 runner matrix with a manifest
merge was rejected: faster, but more moving parts, and the Node image has no
compile step so the emulation cost is small.

## `.github/workflows/cd.yml`

Trigger: push of a tag matching `v*`.

**Job `test`** (`ubuntu-latest`): same steps as `ci.yml`. `npm ci` and `npm test`
in `server/`; `npm ci` and `npm run build` in `web/`. Node 24, npm cache keyed on
each lockfile. This exists so a tag on a commit that never had green CI cannot
publish.

**Job `publish`** (`needs: test`, `ubuntu-latest`), permissions `contents: write`
and `packages: write`, steps in order:

1. `actions/checkout`.
2. `docker/setup-qemu-action`, `docker/setup-buildx-action`.
3. `docker/login-action` against `ghcr.io`, user `github.repository_owner`,
   password `secrets.GITHUB_TOKEN` (same as `stream-share`'s CD; no PAT).
4. `docker/metadata-action` with image `ghcr.io/x3n0n10/stream-share-suite` and
   `type=semver` patterns for `{{version}}`, `{{major}}.{{minor}}`, `{{major}}`,
   with `latest` left on its default (`auto`).
5. `docker/build-push-action`: `platforms: linux/amd64,linux/arm64`, `push: true`,
   tags and labels from the metadata step, GitHub Actions layer cache
   (`cache-from: type=gha`, `cache-to: type=gha,mode=max`).
6. GitHub Release: `gh release create "$GITHUB_REF_NAME" --generate-notes
   --verify-tag`, adding `--prerelease` when the tag name contains `-`. Uses the
   preinstalled `gh` CLI with `GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}`; no extra
   action.

**Resulting tags.** `v1.0.0` publishes `1.0.0`, `1.0`, `1`, `latest`. A
pre-release such as `v1.0.0-rc.1` publishes only `1.0.0-rc.1`; it never moves
`latest`, `1.0` or `1`. The metadata action also sets the OCI labels, including
`org.opencontainers.image.source`, which is what links the GHCR package to this
repository.

## `.github/workflows/dev-build.yml`

Trigger: `workflow_dispatch` with a boolean input `push_image` (default true).
Permissions `contents: read`, `packages: write`. Same QEMU, Buildx, login (only
when pushing), and build steps as `publish`, multi-arch, with tags `dev` and
`dev-<shortsha>`. No test gate and no Release. With `push_image` false it builds
without pushing, to validate the Dockerfile on a branch.

## Repo changes for v1.0.0

- `server/package.json` and `server/package-lock.json`: version `0.1.0` to
  `1.0.0`. `web/package.json` is already `1.0.0`.
- `docker-compose.yml`: the `suite` service switches from `build: .` to
  `image: ghcr.io/x3n0n10/stream-share-suite:latest`. `build: .` stays as a
  commented alternative for people building from source. The existing comment
  about a "published image once one exists" is rewritten to match.
- `README.md` Quick start: describes pulling the published image, and notes the
  `:1` and `:1.0` tags for pinning to a major or minor line.
- Action versions: match the majors `stream-share` already uses (`checkout`
  v7, `setup-qemu`/`setup-buildx`/`login` v4). The implementer verifies the
  current latest major of `build-push-action` and `metadata-action` against
  their release pages at write time rather than guessing.

## One-time manual steps (not automatable)

These go in the PR description, not in code.

- **Make the package public.** A package first pushed to GHCR is private by
  default. After the first publish: GitHub, Packages, `stream-share-suite`,
  Package settings, Change visibility to public. Without this, an anonymous
  `docker pull` fails.
- **Cut the release.** After the PR merges, from an up-to-date `main`:
  `git tag v1.0.0 && git push origin v1.0.0`. The pipeline does not tag by
  itself, and the assistant does not push tags.

## Testing

`ci.yml` has no way to exercise a tag-triggered workflow. Verification is:
`actionlint`-style review of the YAML, a local `docker build .` to confirm the
Dockerfile still builds, the manual `dev-build.yml` run with `push_image` false
after merge to confirm the multi-arch build, and finally a `v1.0.0-rc.1` tag to
exercise the full path (including the pre-release handling) before the real
`v1.0.0`.

## Commits

Commit with the noreply identity `20641331+x3n0n10@users.noreply.github.com`
(already the repo's configured `user.email`); GitHub rejects pushes carrying
the personal address.
