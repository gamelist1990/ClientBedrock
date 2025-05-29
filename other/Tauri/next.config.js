/** @type {import('next').NextConfig} */
const nextConfig = {
  // 静的エクスポートを常に有効にする
  output: 'export',
  trailingSlash: true,
  distDir: 'out',
  assetPrefix: './',
  images: {
    unoptimized: true
  },
  // 開発モード用の設定
  webpack: (config, { dev, isServer }) => {
    // Tauriの開発環境に対応するため、ホットリロードを有効にする
    if (dev && !isServer) {
      config.watchOptions = {
        poll: 1000,
        aggregateTimeout: 300,
      }
    }
    return config
  },
}

export default nextConfig;