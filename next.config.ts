import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Server-only packages that should not be bundled
  serverExternalPackages: ["bcryptjs", "pdf-lib"],
  eslint: {
    dirs: ["src", "prisma", "tests"],
  },
};

export default nextConfig;
