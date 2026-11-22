import type { NextConfig } from "next";

const config: NextConfig = {
  // The shared config package ships TypeScript source.
  transpilePackages: ["@aevum-kit/aevum", "@shaida/index", "@shaida/proofs", "@shaida/relay", "@shaida/pay"],
  // D26: the pay and inbox screens moved into the dashboard; old links keep working.
  async redirects() {
    return [
      { source: "/pay", destination: "/app/pay", permanent: false },
      { source: "/inbox", destination: "/app/inbox", permanent: false },
    ];
  },
};

export default config;
