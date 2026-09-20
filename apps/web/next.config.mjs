/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Monorepo: batasi file tracing ke folder app ini saja.
  outputFileTracingRoot: process.cwd(),
};

export default nextConfig;
