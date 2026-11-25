# Publishing @shaida/sdk (not done: the builder decides)

Nothing here has been run against the npm registry. The tarball and install steps were rehearsed locally
(evidence/sdk/pack.md).

## Once: the account and the name
1. Create or sign in to an npm account with 2FA turned on: `npm login` (or `npm adduser`).
2. The scope `@shaida` needs an npm **organisation** (or a user) named `shaida`. Create it at
   https://www.npmjs.com/org/create (the free plan allows public packages). On 2026-11-25,
   `npm view @shaida/sdk` and `npm view shaida-sdk` both returned 404 (no such package). That does not prove the
   `shaida` org name is free; only creating it does.
3. If the scope can't be had, publish unscoped as `shaida-sdk`. Set `"name": "shaida-sdk"` in
   packages/sdk/package.json, and change `@shaida/sdk` to `shaida-sdk` in packages/sdk/README.md, examples/*.mjs,
   examples/rental-check/app.js and examples/package.json.

## Each release (0.1.0 first)
From a clean checkout of the commit to release, with `make gate` PASS:

```sh
cd packages/sdk
pnpm install --frozen-lockfile
pnpm test                       # builds dist/ and runs S01–S16
npm pack --dry-run              # check the file list: dist/, README.md, NOTICE.md, LICENSE, package.json
pnpm publish --access public    # scoped packages are private by default; pnpm also rewrites workspace:* devDependencies
cd ../..
git tag -a sdk-v0.1.0 -m "@shaida/sdk 0.1.0"
git push origin sdk-v0.1.0
```

Use `pnpm publish` (or `pnpm pack` and then `npm publish <tarball>`), not a bare `npm publish`, so the published
manifest carries no `workspace:` specifiers. Check afterwards that `npm view @shaida/sdk@0.1.0 dist.integrity`
matches the sha512 of the tarball you packed.

For a later version, bump `"version"` in packages/sdk/package.json and in the banner in scripts/build.mjs, add a
DECISIONS note if the API changes (test S13 forces the README in step), then repeat with `sdk-vX.Y.Z`.
