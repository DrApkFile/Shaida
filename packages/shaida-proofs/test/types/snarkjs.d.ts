// The part of snarkjs 0.7.6 (GPL-3.0, iden3) the tests and scripts call. snarkjs ships no type declarations.
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
  export type VerificationKey = Record<string, unknown>;
  export const wtns: {
    check(r1csFile: string, wtnsFile: string, logger: Logger): Promise<boolean>;
  };
  export const groth16: {
    fullProve(
      input: Record<string, unknown>,
      wasmFile: string,
      zkeyFile: string,
    ): Promise<{ proof: Groth16Proof; publicSignals: string[] }>;
    verify(vkey: VerificationKey, publicSignals: string[], proof: Groth16Proof): Promise<boolean>;
  };
}
