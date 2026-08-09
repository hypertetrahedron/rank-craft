/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config) => {
    // The Pyodide worker is bundled by Next's own worker loader via
    // `new Worker(new URL(...), { type: 'module' })`. Pyodide itself is loaded
    // at runtime from a CDN (see NEXT_PUBLIC_PYODIDE_URL), never bundled.
    config.resolve.fallback = { ...config.resolve.fallback, fs: false, path: false, crypto: false }
    return config
  },
}

module.exports = nextConfig
