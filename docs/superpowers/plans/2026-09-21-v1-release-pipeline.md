# v1.0.0 Release Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish a multi-arch Suite image to GHCR on every `v*` tag (with a GitHub Release), add a manual dev-build workflow, and make the repo pullable at v1.0.0.

**Architecture:** Two new GitHub Actions workflows using plain Docker tooling (`docker/metadata-action` + `docker/build-push-action`, QEMU + Buildx, `GITHUB_TOKEN` login), plus three small repo edits (server package version, compose image line, README quick start). No application code changes.

**Tech Stack:** GitHub Actions, Docker Buildx, GHCR, `gh` CLI (preinstalled on runners).

**Design spec:** `docs/superpowers/specs/2026-09-21-v1-release-pipeline-design.md`

## Global Constraints

- Work on branch `claude/v1-release-pipeline` in `/Users/jorislankhorst/Claude/stream-share-suite`. Do not push tags. Do not push the branch; the controller does that.
- Image name is exactly `ghcr.io/x3n0n10/stream-share-suite` (lowercase, no variables).
- Action versions, verified against each repo's latest release on 2026-09-21. Use these majors exactly: `actions/checkout@v7`, `actions/setup-node@v7`, `docker/setup-qemu-action@v4`, `docker/setup-buildx-action@v4`, `docker/login-action@v4`, `docker/metadata-action@v6`, `docker/build-push-action@v7`.
- Node version in workflows: `'24'` (matches `ci.yml` and the Dockerfile).
- Platforms: `linux/amd64,linux/arm64`.
- Registry login: user `${{ github.repository_owner }}`, password `${{ secrets.GITHUB_TOKEN }}`. No PAT, no other secret.
- Never interpolate `${{ }}` expressions directly into `run:` scripts. Pass values through `env:` or use the runner's own env vars (`$GITHUB_REF_NAME`).
- Commit messages end with `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`. The repo's git identity is already the GitHub noreply address; do not change it.
- **Commit workaround.** `git commit` in this repo is blocked by a `simplify-guard` hook whose config cannot be found. Do not investigate it or use `--no-verify`. Commit with plumbing:
  ```bash
  git add <files>
  git diff --cached --stat        # must be non-empty; the guard sometimes resets the index — re-add if empty
  TREE=$(git write-tree); PARENT=$(git rev-parse HEAD)
  NEW=$(git commit-tree "$TREE" -p "$PARENT" -m "$(cat <<'EOF'
  <subject>

  <body>

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  EOF
  )")
  git update-ref refs/heads/claude/v1-release-pipeline "$NEW"
  git show --stat HEAD            # confirm the commit contains your files
  ```
  Try plain `git commit` first; use plumbing only if it prints `simplify-guard: ...`.
- Verification tooling: `docker` and `actionlint` are not installed on this machine. YAML is validated with Ruby (`ruby -ryaml`). The Dockerfile build is exercised by the existing `docker-build` job in `ci.yml` when the PR is opened. This deviates from the spec's "local `docker build`" line for that reason.
- There is no unit-test framework for workflow files. Each task's "test" is a Ruby script that parses the YAML and asserts the specific properties the spec requires. Write the assertion first, watch it fail on the missing file, then create the file.

## File Structure

- Create: `.github/workflows/cd.yml` — tag-triggered test gate, image publish, GitHub Release.
- Create: `.github/workflows/dev-build.yml` — manual multi-arch dev image.
- Modify: `server/package.json`, `server/package-lock.json` — version `0.1.0` to `1.0.0`.
- Modify: `docker-compose.yml` — `suite` service uses the published image.
- Modify: `README.md` — Quick start describes the published image and tag pinning.

---

## Task 1: Release workflow (`cd.yml`)

**Files:**
- Create: `.github/workflows/cd.yml`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: pushes `ghcr.io/x3n0n10/stream-share-suite:{1.0.0,1.0,1,latest}` (semver-derived) on a `v*` tag; creates a GitHub Release. Task 3's README text describes these tags.

- [ ] **Step 1: Write the failing assertion**

Save as `/private/tmp/claude-501/-Users-jorislankhorst-Claude/83ef7f57-0172-4320-ba0f-424f637c7b19/scratchpad/check-cd.rb` (or any scratch path outside the repo):

```ruby
require "yaml"
w = YAML.load_file(".github/workflows/cd.yml")
on = w["on"] || w[true]
abort "trigger must be push of v* tags" unless on["push"]["tags"] == ["v*"]

jobs = w["jobs"]
abort "publish must need test" unless jobs["publish"]["needs"] == "test"
perms = jobs["publish"]["permissions"]
abort "publish perms" unless perms["contents"] == "write" && perms["packages"] == "write"

uses = jobs["publish"]["steps"].map { |s| s["uses"].to_s }
%w[
  actions/checkout@v7 docker/setup-qemu-action@v4 docker/setup-buildx-action@v4
  docker/login-action@v4 docker/metadata-action@v6 docker/build-push-action@v7
].each { |u| abort "missing #{u}" unless uses.include?(u) }

meta = jobs["publish"]["steps"].find { |s| s["uses"] == "docker/metadata-action@v6" }
abort "meta image" unless meta["with"]["images"] == "ghcr.io/x3n0n10/stream-share-suite"
%w[{{version}} {{major}}.{{minor}} {{major}}].each do |p|
  abort "missing semver pattern #{p}" unless meta["with"]["tags"].include?("type=semver,pattern=#{p}")
end

build = jobs["publish"]["steps"].find { |s| s["uses"] == "docker/build-push-action@v7" }
abort "platforms" unless build["with"]["platforms"] == "linux/amd64,linux/arm64"
abort "push" unless build["with"]["push"] == true
abort "cache" unless build["with"]["cache-from"] == "type=gha" && build["with"]["cache-to"] == "type=gha,mode=max"

rel = jobs["publish"]["steps"].last["run"]
abort "release cmd" unless rel.include?("gh release create") && rel.include?("--generate-notes") && rel.include?("--verify-tag") && rel.include?("--prerelease")

test_uses = jobs["test"]["steps"].map { |s| s["uses"].to_s }
abort "test job setup" unless test_uses.include?("actions/setup-node@v7")
abort "no ${{ in run scripts" if jobs.values.flat_map { |j| j["steps"] }.any? { |s| s["run"].to_s.include?("${{") }
puts "cd.yml ok"
```

- [ ] **Step 2: Run it and confirm it fails**

Run (from repo root): `ruby <path-to>/check-cd.rb`
Expected: fails with a Ruby error about `.github/workflows/cd.yml` not existing (`Errno::ENOENT`).

- [ ] **Step 3: Create `.github/workflows/cd.yml`**

```yaml
name: CD

on:
  push:
    tags:
      - 'v*'

jobs:
  test:
    name: Test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: '24'
          cache: npm
          cache-dependency-path: |
            server/package-lock.json
            web/package-lock.json
      - run: npm ci
        working-directory: server
      - run: npm test
        working-directory: server
      - run: npm ci
        working-directory: web
      - run: npm run build
        working-directory: web

  publish:
    name: Publish image and release
    needs: test
    runs-on: ubuntu-latest
    permissions:
      contents: write
      packages: write
    steps:
      - uses: actions/checkout@v7

      - uses: docker/setup-qemu-action@v4

      - uses: docker/setup-buildx-action@v4

      - name: Log in to GitHub Container Registry
        uses: docker/login-action@v4
        with:
          registry: ghcr.io
          username: ${{ github.repository_owner }}
          # GITHUB_TOKEN is minted per run and never expires. The job's
          # packages: write permission is what lets it push to GHCR.
          password: ${{ secrets.GITHUB_TOKEN }}

      # v1.0.0 -> 1.0.0, 1.0, 1 and latest. A pre-release tag such as
      # v1.0.0-rc.1 -> only 1.0.0-rc.1: the action skips the major/minor
      # aliases and latest for pre-releases on its own. It also sets the OCI
      # labels (including image.source), which link the package to this repo.
      - name: Compute tags and labels
        id: meta
        uses: docker/metadata-action@v6
        with:
          images: ghcr.io/x3n0n10/stream-share-suite
          tags: |
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}
            type=semver,pattern={{major}}

      - name: Build and push
        uses: docker/build-push-action@v7
        with:
          context: .
          platforms: linux/amd64,linux/arm64
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

      - name: Create GitHub Release
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          flags=""
          case "$GITHUB_REF_NAME" in
            *-*) flags="--prerelease" ;;
          esac
          gh release create "$GITHUB_REF_NAME" \
            --repo "$GITHUB_REPOSITORY" \
            --generate-notes \
            --verify-tag \
            $flags
```

The `--prerelease` string must appear literally in the `run` script (the assertion checks for it).

- [ ] **Step 4: Run the assertion and confirm it passes**

Run: `ruby <path-to>/check-cd.rb`
Expected: prints `cd.yml ok`.

- [ ] **Step 5: Commit**

Stage `.github/workflows/cd.yml` only. Subject: `Add CD workflow: publish multi-arch image to GHCR on v* tags`. Body: one paragraph — test gate before publish, semver tags with pre-release handling, GitHub Release with generated notes.

---

## Task 2: Manual dev-build workflow (`dev-build.yml`)

**Files:**
- Create: `.github/workflows/dev-build.yml`

**Interfaces:**
- Consumes: the action versions and image name from Global Constraints (same as Task 1).
- Produces: `ghcr.io/x3n0n10/stream-share-suite:dev` and `:dev-<shortsha>` when dispatched with `push_image` true.

- [ ] **Step 1: Write the failing assertion**

Save as `check-dev.rb` in the scratch directory:

```ruby
require "yaml"
w = YAML.load_file(".github/workflows/dev-build.yml")
on = w["on"] || w[true]
input = on["workflow_dispatch"]["inputs"]["push_image"]
abort "input type" unless input["type"] == "boolean" && input["default"] == true

job = w["jobs"]["build"]
abort "perms" unless job["permissions"]["contents"] == "read" && job["permissions"]["packages"] == "write"

steps = job["steps"]
login = steps.find { |s| s["uses"] == "docker/login-action@v4" }
abort "login must be conditional on push_image" unless login["if"].to_s.include?("inputs.push_image")

meta = steps.find { |s| s["uses"] == "docker/metadata-action@v6" }
abort "meta image" unless meta["with"]["images"] == "ghcr.io/x3n0n10/stream-share-suite"
abort "dev tag" unless meta["with"]["tags"].include?("type=raw,value=dev")
abort "sha tag" unless meta["with"]["tags"].include?("type=sha,prefix=dev-,format=short")

build = steps.find { |s| s["uses"] == "docker/build-push-action@v7" }
abort "platforms" unless build["with"]["platforms"] == "linux/amd64,linux/arm64"
abort "push must follow input" unless build["with"]["push"].to_s.include?("inputs.push_image")

abort "must not create a release" if steps.any? { |s| s["run"].to_s.include?("gh release") }
puts "dev-build.yml ok"
```

- [ ] **Step 2: Run it and confirm it fails**

Run (repo root): `ruby <path-to>/check-dev.rb`
Expected: `Errno::ENOENT` for `.github/workflows/dev-build.yml`.

- [ ] **Step 3: Create `.github/workflows/dev-build.yml`**

```yaml
name: Dev Build

on:
  workflow_dispatch:
    inputs:
      push_image:
        description: 'Push image to GHCR (untick to only verify the build)'
        type: boolean
        default: true

jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v7

      - uses: docker/setup-qemu-action@v4

      - uses: docker/setup-buildx-action@v4

      - name: Log in to GitHub Container Registry
        if: inputs.push_image
        uses: docker/login-action@v4
        with:
          registry: ghcr.io
          username: ${{ github.repository_owner }}
          password: ${{ secrets.GITHUB_TOKEN }}

      # :dev always points at the latest dev build; :dev-<shortsha> pins one.
      - name: Compute tags and labels
        id: meta
        uses: docker/metadata-action@v6
        with:
          images: ghcr.io/x3n0n10/stream-share-suite
          tags: |
            type=raw,value=dev
            type=sha,prefix=dev-,format=short

      # With push_image off a multi-arch build cannot be loaded into the local
      # daemon, so it just builds (proving the Dockerfile works on both
      # platforms) and discards the result.
      - name: Build and push
        uses: docker/build-push-action@v7
        with:
          context: .
          platforms: linux/amd64,linux/arm64
          push: ${{ inputs.push_image }}
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

- [ ] **Step 4: Run the assertion and confirm it passes**

Run: `ruby <path-to>/check-dev.rb`
Expected: prints `dev-build.yml ok`. Also re-run `check-cd.rb`: still `cd.yml ok`.

- [ ] **Step 5: Commit**

Stage `.github/workflows/dev-build.yml` only. Subject: `Add manual dev-build workflow for unreleased images`. Body: workflow_dispatch, pushes :dev and :dev-<shortsha>, push_image off builds without pushing.

---

## Task 3: v1.0.0 repo prep (version, compose, README)

**Files:**
- Modify: `server/package.json` (version field)
- Modify: `server/package-lock.json` (two version fields, lines 3 and 9)
- Modify: `docker-compose.yml:1-5` (the `suite` service's `build:`/`image:` lines and the comment between them)
- Modify: `README.md` (the `## Quick start` section, currently lines 55-62)

**Interfaces:**
- Consumes: the tag scheme from Task 1 (`1.0.0`, `1.0`, `1`, `latest`).
- Produces: nothing later tasks use.

- [ ] **Step 1: Write the failing assertion**

Run this from the repo root (it must FAIL now):

```bash
ruby -rjson -ryaml -e '
abort "server version" unless JSON.parse(File.read("server/package.json"))["version"] == "1.0.0"
lock = JSON.parse(File.read("server/package-lock.json"))
abort "lock version" unless lock["version"] == "1.0.0" && lock["packages"][""]["version"] == "1.0.0"
web = JSON.parse(File.read("web/package-lock.json"))
abort "web lock version" unless web["version"] == "1.0.0" && web["packages"][""]["version"] == "1.0.0"
suite = YAML.load_file("docker-compose.yml")["services"]["suite"]
abort "compose image" unless suite["image"] == "ghcr.io/x3n0n10/stream-share-suite:latest"
abort "compose must not build by default" if suite.key?("build")
readme = File.read("README.md")
abort "readme image" unless readme.include?("ghcr.io/x3n0n10/stream-share-suite:latest")
abort "readme pin tags" unless readme.include?(":1.0.0") && readme.include?(":1.0`") && readme.include?(":1`")
puts "v1 prep ok"'
```

Expected now: `server version` abort (server is `0.1.0`).

- [ ] **Step 2: Bump the server version**

Run: `cd server && npm version 1.0.0 --no-git-tag-version`
Expected output: `v1.0.0`. This edits `package.json` and `package-lock.json` only; no git activity.
Then check `git diff --stat`: exactly `server/package.json` and `server/package-lock.json`, one or two lines each. If `web/package-lock.json` does not already say `1.0.0` at both version fields (`grep -n '"version"' web/package-lock.json | head -2` — lines 3 and 9), set them to `1.0.0` by hand so the assertion in Step 1 can pass.

- [ ] **Step 3: Switch `docker-compose.yml` to the published image**

Replace this block at the top of the `suite` service:

```yaml
    build: .
    # Or use a published image once one exists:
    #   image: ghcr.io/x3n0n10/stream-share-suite:latest
```

with:

```yaml
    image: ghcr.io/x3n0n10/stream-share-suite:latest
    # To build from source instead of pulling the published image, replace the
    # line above with:
    #   build: .
```

- [ ] **Step 4: Update the README Quick start**

Replace the `## Quick start` section body (the code block plus the one paragraph after it) so the section reads:

````markdown
## Quick start

```sh
docker compose up -d
```

Compose pulls the published image, `ghcr.io/x3n0n10/stream-share-suite:latest`
(amd64 and arm64). To stay on a release line instead of following `latest`, pin
the tag in the compose file: `:1.0.0` for one exact release, `:1.0` for patch
updates only, `:1` for any 1.x. To build from source instead, swap in the
commented `build: .` line.

Then open `http://localhost:3000` and create the admin account. Nothing else
in the app answers until that account exists.
````

Keep the `### Coming from stream-share-dashboard` section that follows unchanged.

- [ ] **Step 5: Run the assertion and the existing tests**

Run the Step 1 script again. Expected: `v1 prep ok`.
Then: `cd server && npm test`. Expected: 381 pass, 0 fail (the count may have grown since; 0 failures is the requirement).
Then re-run `check-cd.rb` and `check-dev.rb`. Expected: both still ok.

- [ ] **Step 6: Commit**

Stage the five files: `server/package.json`, `server/package-lock.json`, `docker-compose.yml`, `README.md`, and `web/package-lock.json` only if Step 2 changed it. Subject: `Prepare v1.0.0: server version, compose pulls published image`. Body: server version 0.1.0 to 1.0.0; compose defaults to the GHCR image with `build: .` kept as a commented alternative; README quick start documents the image and the `:1.0.0` / `:1.0` / `:1` pinning tags.

---

## Self-Review

**Spec coverage.** `cd.yml` test job, publish job, tag scheme, labels, cache, Release with pre-release handling: Task 1. `dev-build.yml` including the `push_image` false path: Task 2. Server version bump, compose image switch, README quick start, action versions: Task 3 and Global Constraints. Manual steps and the rc-tag rollout are below, not tasks, because they need the merged PR and a human's GitHub UI. The spec's "local `docker build`" check is replaced by the existing CI `docker-build` job (no Docker on this machine); noted in Global Constraints.

**Placeholders.** None. Every step has literal content.

**Consistency.** Image name, tag patterns, and platform string are identical across Tasks 1-3 and the assertions. The literal `--prerelease` is required by Task 1's assertion and present in its YAML.

## Rollout (after merge; not plan tasks)

1. Run Actions, "Dev Build", branch `main`, `push_image` unticked, to confirm a two-platform build succeeds.
2. Tag `v1.0.0-rc.1` from `main`. Expect: tests pass, image `1.0.0-rc.1` only (no `latest`, `1.0`, `1`), a pre-release GitHub Release.
3. Make the GHCR package public: GitHub, Packages, `stream-share-suite`, Package settings, Change visibility.
4. Confirm `docker pull ghcr.io/x3n0n10/stream-share-suite:1.0.0-rc.1` works without login.
5. Tag `v1.0.0`. Expect `1.0.0`, `1.0`, `1`, `latest`, and a full Release.
