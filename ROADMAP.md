# ROADMAP

Ideas not built. Nothing here is claimed anywhere else.

- `IncomeVerifier.checkBundle` / `attestBundle`: the PRD §5 bundle rules on chain (one context, one root, disjoint
  ranges, Σ thresholds) for proofs of more than 4 payments. Today `check`/`attest` take one proof; bundles are
  verified off-chain by `verifyIncomeLink`.
- Deploy `IncomeVerifier` in `DeployStack.s.sol` once `ceremony/finalize.ts` has written the real verifier.

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
