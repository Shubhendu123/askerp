/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['@duckdb/node-api'],
    // D-045: policy documents are discovered with fs.readdirSync at runtime, which Next's static file tracing
    // cannot see. Without this, the Vercel build ships zero policy chunks (silently). Only /api/ask retrieves.
    outputFileTracingIncludes: {
      '/api/ask': ['./harborline/policies/*.md', './harborline/corpus/**/*.md', './harborline/corpus_rendered/**/*.md'], // D-048: documents + rendered templates (without these production ships zero documents)
    },
  },
};

export default nextConfig;
