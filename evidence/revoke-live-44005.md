# Revocation and reader codes, live check on Aevum testnet (44005), 2026-11-26

The hosted site at https://shaida.onrender.com, commit `fc4ba32` (from `/api/health`), built with Revocations
`0x3b19c8f3…f2e4` (evidence/revocations-44005.md). Personas are demo. The builder clicked it by hand in Firefox, as
in the checklist; the agent checked the chain afterwards, read-only. Facts: [run.json](revoke-live-44005/run.json).

## What the builder did
1. **Bola** (profile `shaida-acme-bola`), `/v` → "Get a code to give the person proving to you" → copied it → gave
   it to Ada. The code is in no file of this repo: the one screenshot of the card that showed part of it was left
   out.
2. **Ada**, `/app/prove`: Income, for a landlord; reader "Landlord Bola" with Bola's code; 23 Nov 2026 (live run
   2's three payments); at least 1 tUSD8. Built in **21.3 s** in the browser (1 proof), checked VALID there; the card
   says Protection **Code-protected**, Revocable **Yes, from Shared proofs**, expires 27 Dec 2026 →
   [02](revoke-live-44005/02-ada-link-ready-code-protected.png).
3. **Bola** opens the link with his name and code → **VALID**: at least 1 tUSD8 in 3 payments, 23 Nov 2026; Reader
   check "Code-protected"; Revocation "Not revoked (checked on chain at the same block)" →
   [03](revoke-live-44005/03-bola-valid-name-and-code.png). With the code cleared → **WrongReader**, "This link is
   code-protected: it needs your name and the reader code you gave the sender" →
   [04](revoke-live-44005/04-bola-wrong-reader-name-only.png).
4. **Ada**, `/app/shared` → Revoke → the confirm ("Anyone you shared this with will see it as revoked. This can't be
   undone.") → "Revoke it" → **Revoking…** → **Revoked in block 4139250** →
   [05](revoke-live-44005/05-ada-revoking.png), [06](revoke-live-44005/06-ada-revoked-in-block.png).
5. **Bola** verifies again → **REVOKED** ProofRevoked, "Revoked on chain in block 4139250, 26 Nov 2026, 03:48 your
   time" → [07](revoke-live-44005/07-bola-revoked.png).
6. An old link: the builder opened **live run 2's** link (23 Nov, at least 1 tUSD8; not run 1's) → **VALID**,
   Reader check "Name only: anyone with this link and the name can view it", Revocation "Not revocable (made before
   revocation existed)" → [08](revoke-live-44005/08-run2-v1-valid-not-revocable.png). Run 1's link was checked by
   the agent instead: `make judge-ui` (VALID, labelled name-only and not revocable) and the SDK's live check (VALID).

Screenshots: 02, 05 and 06 are about 390 px wide; 03, 04, 07 and 08 were taken at desktop width (about 1,300 px).
The 390 px layout of /v's new states is in [revoke-code-ui/](revoke-code-ui/report-390.md) (fork) and
[judge-ui/](judge-ui/report-390.md) (live). Not screenshotted by the builder: Bola's Check on-chain on Ada's link.

## Checked by the agent (read-only)
- **The only revoke.** `Revoked` events of Revocations, read in 1,000-block chunks from its deploy block 4135878 to
  4139990: exactly one, in block 4139250, tx
  [`0x920fd1f6…f8b2`](https://explorer-test.qday.info/tx/0x920fd1f6ad1b529440a1500e3215e411ea94c80e21bdc14545c36d9d222ef8b2),
  salt `0x2c4e9e58…7df60`, `blockNumber` 4139250 in the event data. It is the block Ada's page and Bola's REVOKED
  name.
- **The tx.** From the relayer `0xF4945dD5…01422` (nonce 23), to Revocations, selector `0x20c5429b` =
  `revoke(uint256)`, legacy (type 0), 1 gwei, gas limit 101,134, status 1, **77,796 gas**: the same as every revoke
  on the fork (evidence/revocations-gas.md). Block time 2026-11-26T02:48:06Z (03:48 at the builder's UTC+1).
- **The relayer sent nothing else.** Its nonce is 24 after it, and its balance went from 0.020113134 (read before the
  deploy) to 0.020035338 tQDAY: exactly 77,796 gas at 1 gwei. So this revoke is also the relayer's latest tx.
- `Revocations.revokedAt(salt)` = 4139250 (eth_call); `make judge-ui` checks it on every run.
- Old links with the registry live: run 1 VALID in the SDK (`pnpm --filter shaida-sdk live`, evidence/sdk/live-44005.md)
  and in the browser (`make judge-ui`); the bot's sample link gives the same decision ids as before D35
  (`a63582509992a400` APPROVE, `1bcd953eed6a1ec1` DECLINE).

The link itself is not kept anywhere: it was code-protected, and verifying it would need the code. That the revoked
salt is this link's rests on the block (the only revoke, and the block both pages show).
