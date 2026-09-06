# Branches and releases

Work flows one way, and each step up produces something more finished than the
last.

```
  any branch  ──►  dev  ──►  staging  ──►  main
                    │          │            │
              test build    nightly      release
             (artifacts)  (prerelease)  (tagged, latest)
```

| Branch | Accepts | On merge | Result |
|---|---|---|---|
| `dev` | anything | build all four targets | artifacts on the run, kept 14 days |
| `staging` | **only `dev`** | build + publish | prerelease tagged `nightly-<date>-<time>` |
| `main` | **only `staging`** | build + publish | release tagged `v<version>`, marked latest |

Every step builds the same four bundles: Windows `.exe` and `.msi`, macOS `.dmg`
for Apple silicon and Intel, and Linux `.deb`.

---

## Day to day

**Working on something.** Branch off `dev`, open a pull request into `dev`.
Merging it builds installers you can hand to someone: open the run under
**Actions** and take them from the *Artifacts* section at the bottom.

**Ready to test properly.** Open a pull request from `dev` into `staging`.
Merging publishes a nightly prerelease that anyone can download from the
releases page. The ten most recent nightlies are kept; older ones are removed
along with their tags.

**Ready to ship.** Open a pull request from `staging` into `main`. Merging cuts
a release with a new version and tag.

Nothing else may merge into `staging` or `main`. A pull request from the wrong
branch fails the **Check the source branch** job, and because branch protection
requires that job, the merge button stays disabled.

---

## Versions

Tags are the record, not a file. Each release takes the newest `v*` tag and adds
one to the patch number — `v0.4.2` becomes `v0.4.3` — so an ordinary release
needs no version edit anywhere, and no workflow ever has to commit to `main`.

For a minor or major version, set `version` in
`packages/desktop/src-tauri/tauri.conf.json` before the merge:

```jsonc
"version": "0.5.0"
```

Anything higher than the newest tag is treated as deliberate and used as-is.
Anything lower or equal is ignored in favour of the patch bump, so a stale file
cannot quietly re-release an old number. If the tag it settles on already
exists, the run fails rather than overwriting a release.

To release an exact version once, run the **main — release** workflow by hand
from the Actions tab and give it the version.

The installers are stamped by `packages/desktop/set-version.mjs`, which writes
the number into `tauri.conf.json`, `Cargo.toml` and `package.json` on the runner
just before the build. Those edits are never committed — which is exactly why
`main` can stay protected.

---

## The workflows

| File | Runs on | Does |
|---|---|---|
| `build.yml` | called by the others | typecheck, test, then build all four bundles |
| `dev.yml` | push and PR to `dev` | build, keep the bundles as artifacts |
| `staging.yml` | push to `staging` | build, publish the nightly, prune old ones |
| `release.yml` | push to `main` | work out the version, build, publish the release |
| `merge-guard.yml` | PRs into `staging` and `main` | reject the wrong source branch |

`build.yml` is a reusable workflow, so a nightly and a release are compiled by
exactly the same steps as a test build — only what happens to the output
differs.

Each platform's runner uploads into a **draft** release. It is only undrafted
once all four have finished, so nobody can download a release that is missing
their installer.

---

## Branch protection

`main` and `staging` both require a pull request, the merge guard to pass, and
conversations to be resolved. Force pushes and deletions are blocked, and the
rules apply to administrators too — including direct pushes from a laptop.

`dev` is deliberately open: it is where work lands.

To see or change the rules:

```bash
gh api repos/:owner/:repo/branches/main/protection
gh api repos/:owner/:repo/branches/staging/protection
```

---

## Signing

The installers are unsigned, so the first launch needs one confirmation:
**More info → Run anyway** on Windows, right-click → **Open** on macOS.

Signing them means buying certificates and adding them as repository secrets —
an Authenticode certificate for Windows, an Apple Developer ID plus
notarisation for macOS. `tauri-action` picks both up from the standard
environment variables once the secrets exist; nothing in these workflows needs
to change.
