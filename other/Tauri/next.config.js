/** @type {import('next').NextConfig} */
const nextConfig = {
  // Tauriアプリケーション用の設定
  output: 'export',
  trailingSlash: true,
  images: {
    unoptimized: true
  },
  assetPrefix: './',
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