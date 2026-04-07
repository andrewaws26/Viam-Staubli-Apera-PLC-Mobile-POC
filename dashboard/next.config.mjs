import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow importing TypeScript from the shared package
  transpilePackages: ['@ironsight/shared'],
  // @viamrobotics/sdk uses Node.js built-ins that must be stubbed for the browser
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      '@ironsight/shared': path.resolve(__dirname, '../packages/shared/src'),
    };
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
