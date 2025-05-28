/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  distDir: 'dist',
  trailingSlash: true,
  images: {
    unoptimized: true
  },
  assetPrefix: './',
  // Tauri expects a static output
  reactStrictMode: true,
  swcMinify: true,
}

export default nextConfig
