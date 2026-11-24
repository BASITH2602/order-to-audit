import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Lint rules are not part of the build gate for this prototype (Next 15).
  eslint: { ignoreDuringBuilds: true },
}

export default nextConfig
