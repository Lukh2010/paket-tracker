import type { NextConfig } from 'next';

const nextConfig: NextConfig = process.env.UNTERWEGS_DESKTOP_BUILD === '1'
  ? { output: 'standalone' }
  : {};

export default nextConfig;
