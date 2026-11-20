// SPDX-License-Identifier: GPL-3.0
// Shaida income circuit (PRD §3). GPL-3.0 because it includes circomlib (GPL-3.0); see NOTICE.md (D6).
//
// Proves: "at least `count` payments, each vouched by a registered payer through ShaidaLedger and then
// swept into a note only the prover can open, with vouch-leaf indices in [fromIndex, toIndex], add up
// to at least `threshold` of `asset`", against one ShaidaLedger root. Nothing else is public.
//
// Per used slot (used slots first, vouch-leaf indices strictly increasing):
//   Cp = Poseidon(secretP, amount, asset)       the payment note (Gloam commitment)
//   V  = Poseidon(1, payerId, Cp)               in the ledger tree at vIdx, fromIndex <= vIdx <= toIndex
//   N  = Poseidon(secretP, Cp)                  Gloam's nullifier of the payment note
//   Cs = Poseidon(secretS, amountS, asset)      the sweep note, secretS != 0
//   S  = Poseidon(2, N, Cs)                     in the ledger tree
//   amount < 2^64
// Across slots: sum(amount) >= threshold, count = number of used slots >= 1.
// `context` = Poseidon(readerIdHash, expiry, salt) is checked by the verifier (PRD §5), not here; it is
// bound to the proof by a dummy square so the proof cannot be replayed under another context.
//
// Changing this file invalidates the phase-2 ceremony (BUILD_CONTRACT, CEREMONY.md).
pragma circom 2.1.6;

include "./lib/income_template.circom";

component main {public [ledgerRoot, asset, threshold, count, fromIndex, toIndex, context]} = Income(8, 20);
