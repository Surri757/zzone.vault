/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  distDir: process.env.ZZONE_NEXT_DIST_DIR || ".next"
};

export default nextConfig;
