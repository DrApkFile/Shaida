# ROADMAP

Ideas not built. Nothing here is claimed anywhere else.

- `IncomeVerifier.checkBundle` / `attestBundle`: the PRD §5 bundle rules on chain (one context, one root, disjoint
  ranges, Σ thresholds) for proofs of more than 4 payments. Today `check`/`attest` take one proof; bundles are
  verified off-chain by `verifyIncomeLink`.

## Optional payer-name disclosure (PRD P1, not built)
The recipient could choose to show the reader the display name of the payers in the range (today the reader sees payer
ids and can guess names against `PayerRegistered`'s name hash). Not built.

## Relayer key pool
One relayer key per process signs every relayed call (D19); a stuck nonce holds the queue. Add a pool of keys with a
dispatcher, each key with its own nonce lane (AEVUM_INTEGRATION §4 hardening item 6).

## Reader code (authenticated reader)
- reader code: the reader generates a random code on /v and gives it to the recipient, who binds the proof to it via
  the existing context field (no circuit change). Today the link is bound to the reader's name only, which anyone can
  type (LIMITS.md, D27).

## Underwriting bot, next (D30)
- Signed decisions: the bot signs `{decisionId, proofId, policy hash, kind, codes, evaluatedAt}` with its key, so a
  lender can keep a decision and show it to a third party without asking the bot again.
- Put the policy on chain: an `attest` variant (or a small registry) that records the policy hash and decision with
  the proof, so the on-chain record says which policy it passed, not only that it passed IncomeVerifier.
- Applicant binding: combine the reader code (above) with the bot, so an APPROVE is for the applicant who received
  the code, not for anyone holding the link.
- Policies per lender: let an operator publish their own policy file (and reader name) behind the same engine.
- A steadiness rule ("payments in at least N distinct months") needs the circuit to expose more than the range; it
  would change the circuit and so the ceremony (CLAUDE.md), so it is not a config change.

## @shaida/sdk, next (D33)
- **Payer side (deferred from 0.1.0).** A platform making vouched payments through ShaidaLedger needs Gloam notes,
  shield/transfer proving with the final keys, the payer's EIP-712 vouch signature, the relayer or self-paid gas, and
  the recipient's receive key. In the app this lives in `packages/shaida-pay` on top of `@gloamtrade/sdk` and the
  web vault; it does not separate cleanly into a small, safe package before the Dec 3 freeze, so 0.1.0 ships the
  verify side only.
- Publish to npm (the commands are in packages/sdk/PUBLISHING.md; not published).
- On-chain bundle checks in `checkOnChain` once `IncomeVerifier.checkBundle` exists (above).
- More RPCs: `verifyIncomeLink` against two independent RPCs and refuse on disagreement.
- A mainnet network entry when Shaida is deployed there (a new pinned config, never an option on 44005).
