import path from 'path';
import { fileURLToPath } from 'url';
import { withSentryConfig } from '@sentry/nextjs';

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

export default withSentryConfig(nextConfig, {
  // Suppress source map upload warnings when SENTRY_AUTH_TOKEN is not set
  silent: true,
  // Don't widen the scope of the build
  disableLogger: true,
});
