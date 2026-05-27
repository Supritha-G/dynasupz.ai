/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@dynasupz/types'],
  env: {
    API_URL: process.env.API_URL ?? 'http://localhost:4000/api/v1',
  },
};

export default nextConfig;
