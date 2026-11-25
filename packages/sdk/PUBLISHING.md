# Publishing shaida-sdk (not done: the builder decides)

Nothing here has been run against the npm registry. The tarball and the clean install were rehearsed locally
(evidence/sdk/pack.md).

## The name
The package is the unscoped `shaida-sdk` (D34). The npm scope `@shaida` belongs to another user's account, so the
SDK can't be published there. `@shaida/proofs`, `@shaida/underwrite` and the other `@shaida/*` names are private
workspace packages that are never published; the shipped manifest names none of them (test S19). On 2026-11-25
`npm view shaida-sdk` returned 404 (no such package). Only the first publish proves the name is free.

## Once
An npm account with 2FA turned on. With `--auth-type=web`, npm opens the browser for the login and the 2FA step,
so no token is typed or stored by hand.

## Each release (0.1.0 first)
From a clean checkout of the commit to release, with `make gate` PASS:

```sh
pnpm install --frozen-lockfile
pnpm --filter shaida-sdk test                  # builds dist/ and runs S01–S19
pnpm --filter shaida-sdk tarball               # writes packages/sdk/shaida-sdk-0.1.0.tgz and prints its sha512
tar -tzf packages/sdk/shaida-sdk-0.1.0.tgz     # package/ + dist/, README.md, NOTICE.md, LICENSE, package.json
npm publish packages/sdk/shaida-sdk-0.1.0.tgz --auth-type=web
npm view shaida-sdk@0.1.0 dist.integrity       # must equal the sha512 printed by the tarball step
```

Publish the tarball made by `tarball` (scripts/pack.mjs), not with `npm publish` or `pnpm publish` run in
packages/sdk. The script ships only the public fields of package.json (no devDependencies, no scripts). Run in the
package directory, npm would ship the `workspace:*` devDependencies, and pnpm would rewrite them to
`@shaida/proofs@0.1.0` and `@shaida/underwrite@0.1.0`: names under a scope Shaida doesn't own.

## The git tag
`sdk-v0.1.0` exists already, on 280f136 (the merge of feat/sdk, before the rename). That commit's package is called
`@shaida/sdk`, which can't be published, so the tag names a commit that is not the release. Recommended (D34):
leave it, and tag the commit you publish from with a new name, after `npm publish` succeeds:

```sh
git tag -a shaida-sdk-v0.1.0 -m "shaida-sdk 0.1.0 (npm)" <commit>
git push origin shaida-sdk-v0.1.0
```

For a later version, bump `"version"` in packages/sdk/package.json and in the banner in
scripts/build.mjs. Add a DECISIONS note if the API changes (test S13 forces the README to follow). Tag the
released commit `shaida-sdk-vX.Y.Z` with `git tag -a`, then push the tag.
