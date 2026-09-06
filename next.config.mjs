/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
  // These packages use dynamic require()/native bindings — keep them out of the
  // webpack bundle for server components / route handlers.
  experimental: {
    serverComponentsExternalPackages: [
      "@tensorflow/tfjs",
      "nsfwjs",
      "pngjs",
      "jpeg-js",
      "file-type",
      "bcryptjs",
    ],
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "media.giphy.com" },
      { protocol: "https", hostname: "*.giphy.com" },
      { protocol: "https", hostname: "i.giphy.com" },
    ],
  },
  webpack: (config) => {
    // nsfwjs / tfjs pull optional native deps we don't use in the pure-JS (CPU) path.
    config.resolve.alias = {
      ...config.resolve.alias,
      "@tensorflow/tfjs-node": false,
    };
    return config;
  },
};

export default nextConfig;
