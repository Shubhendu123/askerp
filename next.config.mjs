/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['@duckdb/node-api'],
  },
};

export default nextConfig;
