/** @type {import('next').NextConfig} */
export default {
  transpilePackages: ["@agentfund/shared", "@agentfund/cardano-tx"],
  serverExternalPackages: ["@evolution-sdk/evolution"],
  poweredByHeader: false,
  webpack(config) {
    // Workspace packages are TypeScript with ESM-style ".js" import specifiers.
    config.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"] };
    return config;
  },
};
