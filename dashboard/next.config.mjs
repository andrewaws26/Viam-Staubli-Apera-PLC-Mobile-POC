/** @type {import('next').NextConfig} */
const nextConfig = {
  // @viamrobotics/sdk uses Node.js built-ins that must be stubbed for the browser
  webpack: (config) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      net: false,
      tls: false,
      dns: false,
      dgram: false,
    };
    return config;
  },
};

export default nextConfig;
