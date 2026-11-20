// SPDX-License-Identifier: MIT
// Adapted from gloamtrade/gloam contracts/circuits/common/merkle_poseidon.circom
// (MIT, (c) 2026 Gloam, commit d8db1e6c). Same hashing and path format as Gloam's
// IncrementalMerkleTreePoseidon (depth 20, H = Poseidon(2)), which ShaidaLedger uses.
// Change: the root is an output instead of `root === hashes[levels]`, so the income
// circuit can require it only for used slots, and the leaf index is an output.
pragma circom 2.1.6;

include "circomlib/circuits/poseidon.circom";

template HashLeftRight() {
    signal input left;
    signal input right;
    signal output hash;
    component h = Poseidon(2);
    h.inputs[0] <== left;
    h.inputs[1] <== right;
    hash <== h.out;
}

template DualMux() {
    signal input in[2];
    signal input s;
    signal output out[2];
    s * (1 - s) === 0;
    out[0] <== (in[1] - in[0]) * s + in[0];
    out[1] <== (in[0] - in[1]) * s + in[1];
}

/// Root of the path from `leaf`, and the leaf's index = sum(pathIndices[i] * 2^i)
/// (pathIndices[i] = 1 when the node at level i is a right child, as in Gloam's tree).
template MerkleRootAndIndex(levels) {
    signal input leaf;
    signal input pathElements[levels];
    signal input pathIndices[levels];
    signal output root;
    signal output index;

    component selectors[levels];
    component hashers[levels];
    signal hashes[levels + 1];
    var acc = 0;
    hashes[0] <== leaf;
    for (var i = 0; i < levels; i++) {
        selectors[i] = DualMux();
        selectors[i].in[0] <== hashes[i];
        selectors[i].in[1] <== pathElements[i];
        selectors[i].s <== pathIndices[i];
        hashers[i] = HashLeftRight();
        hashers[i].left <== selectors[i].out[0];
        hashers[i].right <== selectors[i].out[1];
        hashes[i + 1] <== hashers[i].hash;
        acc += pathIndices[i] * (1 << i);
    }
    root <== hashes[levels];
    index <== acc;
}
