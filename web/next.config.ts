import type { NextConfig } from "next";

const config: NextConfig = {
  // The shared config package ships TypeScript source.
  transpilePackages: ["@aevum-kit/aevum", "@shaida/index", "@shaida/proofs", "@shaida/relay", "@shaida/pay"],
};

export default config;
