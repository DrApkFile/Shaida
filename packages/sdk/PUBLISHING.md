# Publishing shaida-sdk

0.1.0 was published by the builder on 2026-11-25 (https://www.npmjs.com/package/shaida-sdk), from the tarball packed at 134d704
(sha512 `3az4S9…CAtA==`, evidence/sdk/pack.md), and tagged `shaida-sdk-v0.1.0` on 3175fe5. A clean install from the
registry is checked by `pnpm --filter shaida-sdk npm-check` (evidence/sdk/npm-install.md).

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

## The git tags
`sdk-v0.1.0` stays on 280f136 (the merge of feat/sdk, before the rename; its package is `@shaida/sdk`): a pushed tag
is not moved. The 0.1.0 release is tagged `shaida-sdk-v0.1.0` on 3175fe5 (decided by the builder, D34). For each
release, after `npm publish` succeeds:

```sh
git tag -a shaida-sdk-vX.Y.Z -m "shaida-sdk X.Y.Z (npm)" <commit>
git push origin shaida-sdk-vX.Y.Z
```

For a later version, bump `"version"` in packages/sdk/package.json and in the banner in
scripts/build.mjs. Add a DECISIONS note if the API changes (test S13 forces the README to follow).
