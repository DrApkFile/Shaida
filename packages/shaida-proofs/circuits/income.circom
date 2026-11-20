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

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/bitify.circom";
include "./lib/merkle.circom";

// Leaf tags, equal to ShaidaLedger.VOUCH_TAG and SWEEP_TAG.
function VOUCH_TAG() { return 1; }
function SWEEP_TAG() { return 2; }
function AMOUNT_BITS() { return 64; }
// 8 * (2^64 - 1) < 2^67 < 2^68: the sum of all slots and the threshold both fit.
function SUM_BITS() { return 68; }

template Income(slots, levels) {
    // ── public, in this order (BUILD_CONTRACT: frozen) ──
    signal input ledgerRoot;
    signal input asset;
    signal input threshold;
    signal input count;
    signal input fromIndex;
    signal input toIndex;
    signal input context;

    // ── private, per slot ──
    signal input used[slots];
    signal input secretP[slots];
    signal input amount[slots];
    signal input payerId[slots];
    signal input vPathElements[slots][levels];
    signal input vPathIndices[slots][levels];
    signal input secretS[slots];
    signal input amountS[slots];
    signal input sPathElements[slots][levels];
    signal input sPathIndices[slots][levels];

    // Public range bounds: comparators below are only sound on inputs of at most their bit width.
    component fromBits = Num2Bits(levels);
    fromBits.in <== fromIndex;
    component toBits = Num2Bits(levels);
    toBits.in <== toIndex;
    component thresholdBits = Num2Bits(SUM_BITS());
    thresholdBits.in <== threshold;

    // Binds `context` to the proof (a public input in no constraint would not be checked).
    signal contextSquare;
    contextSquare <== context * context;

    component cp[slots];
    component v[slots];
    component vTree[slots];
    component n[slots];
    component cs[slots];
    component s[slots];
    component sTree[slots];
    component amountBits[slots];
    component secretSIsZero[slots];
    component atOrAfterFrom[slots];
    component atOrBeforeTo[slots];
    component increasing[slots];
    signal usedAmount[slots];

    var usedSum = 0;
    var amountSum = 0;

    for (var i = 0; i < slots; i++) {
        // used is 0/1, and used slots come first (no gaps).
        used[i] * (1 - used[i]) === 0;
        if (i > 0) {
            used[i] * (1 - used[i - 1]) === 0;
        }

        // 1. payment note
        cp[i] = Poseidon(3);
        cp[i].inputs[0] <== secretP[i];
        cp[i].inputs[1] <== amount[i];
        cp[i].inputs[2] <== asset;

        // 2. vouch leaf in the ledger tree, index in range
        v[i] = Poseidon(3);
        v[i].inputs[0] <== VOUCH_TAG();
        v[i].inputs[1] <== payerId[i];
        v[i].inputs[2] <== cp[i].out;
        vTree[i] = MerkleRootAndIndex(levels);
        vTree[i].leaf <== v[i].out;
        for (var j = 0; j < levels; j++) {
            vTree[i].pathElements[j] <== vPathElements[i][j];
            vTree[i].pathIndices[j] <== vPathIndices[i][j];
        }
        used[i] * (vTree[i].root - ledgerRoot) === 0;

        atOrAfterFrom[i] = LessEqThan(levels);
        atOrAfterFrom[i].in[0] <== fromIndex;
        atOrAfterFrom[i].in[1] <== vTree[i].index;
        used[i] * (1 - atOrAfterFrom[i].out) === 0;
        atOrBeforeTo[i] = LessEqThan(levels);
        atOrBeforeTo[i].in[0] <== vTree[i].index;
        atOrBeforeTo[i].in[1] <== toIndex;
        used[i] * (1 - atOrBeforeTo[i].out) === 0;

        // strictly increasing vouch indices across used slots: no payment counted twice
        if (i > 0) {
            increasing[i] = LessThan(levels);
            increasing[i].in[0] <== vTree[i - 1].index;
            increasing[i].in[1] <== vTree[i].index;
            used[i] * (1 - increasing[i].out) === 0;
        }

        // 3. nullifier of the payment note (Gloam: Poseidon(secret, commitment))
        n[i] = Poseidon(2);
        n[i].inputs[0] <== secretP[i];
        n[i].inputs[1] <== cp[i].out;

        // 4. sweep note, opened with a non-zero secret
        cs[i] = Poseidon(3);
        cs[i].inputs[0] <== secretS[i];
        cs[i].inputs[1] <== amountS[i];
        cs[i].inputs[2] <== asset;
        secretSIsZero[i] = IsZero();
        secretSIsZero[i].in <== secretS[i];
        used[i] * secretSIsZero[i].out === 0;

        // 5. sweep leaf in the ledger tree
        s[i] = Poseidon(3);
        s[i].inputs[0] <== SWEEP_TAG();
        s[i].inputs[1] <== n[i].out;
        s[i].inputs[2] <== cs[i].out;
        sTree[i] = MerkleRootAndIndex(levels);
        sTree[i].leaf <== s[i].out;
        for (var j = 0; j < levels; j++) {
            sTree[i].pathElements[j] <== sPathElements[i][j];
            sTree[i].pathIndices[j] <== sPathIndices[i][j];
        }
        used[i] * (sTree[i].root - ledgerRoot) === 0;

        // 6. amount < 2^64, counted only when used
        amountBits[i] = Num2Bits(AMOUNT_BITS());
        amountBits[i].in <== amount[i];
        usedAmount[i] <== used[i] * amount[i];

        usedSum += used[i];
        amountSum += usedAmount[i];
    }

    // count = number of used slots, at least one (used slots come first, so used[0] = 1).
    count === usedSum;
    used[0] === 1;

    component enough = GreaterEqThan(SUM_BITS());
    enough.in[0] <== amountSum;
    enough.in[1] <== threshold;
    enough.out === 1;
}

component main {public [ledgerRoot, asset, threshold, count, fromIndex, toIndex, context]} = Income(8, 20);
