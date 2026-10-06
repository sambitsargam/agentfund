/** @type {import('next').NextConfig} */
export default {
  transpilePackages: ["@agentfund/shared"],
  poweredByHeader: false,
  webpack(config) {
    // Workspace packages are TypeScript with ESM-style ".js" import specifiers.
    config.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"] };
    return config;
  },
};
