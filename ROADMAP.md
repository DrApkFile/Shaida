# ROADMAP

Ideas not built. Nothing here is claimed anywhere else.

- `IncomeVerifier.checkBundle` / `attestBundle`: the PRD §5 bundle rules on chain (one context, one root, disjoint
  ranges, Σ thresholds) for proofs of more than 4 payments. Today `check`/`attest` take one proof; bundles are
  verified off-chain by `verifyIncomeLink`.
- Deploy `IncomeVerifier` in `DeployStack.s.sol` once `ceremony/finalize.ts` has written the real verifier.
