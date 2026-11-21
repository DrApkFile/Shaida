// The part of snarkjs 0.7.6 (GPL-3.0, iden3) the ceremony calls. snarkjs ships no type declarations.
declare module "snarkjs" {
  export interface Logger {
    info(msg: string): void;
    warn(msg: string): void;
    debug(msg: string): void;
    error(msg: string): void;
  }
  export interface Groth16Proof {
    pi_a: string[];
    pi_b: string[][];
    pi_c: string[];
    protocol: string;
    curve: string;
  }
  export const zKey: {
    newZKey(r1cs: string, ptau: string, zkey: string, logger?: Logger): Promise<unknown>;
    contribute(oldZkey: string, newZkey: string, name: string, entropy: string, logger?: Logger): Promise<Uint8Array>;
    beacon(oldZkey: string, newZkey: string, name: string, beaconHashHex: string, iterationsExp: number, logger?: Logger): Promise<Uint8Array | false>;
    verifyFromR1cs(r1cs: string, ptau: string, zkey: string, logger?: Logger): Promise<boolean>;
    exportVerificationKey(zkey: string, logger?: Logger): Promise<unknown>;
  };
  export const groth16: {
    fullProve(input: Record<string, unknown>, wasmFile: string, zkeyFile: string): Promise<{ proof: Groth16Proof; publicSignals: string[] }>;
    verify(vkey: unknown, publicSignals: string[], proof: Groth16Proof): Promise<boolean>;
  };
}
