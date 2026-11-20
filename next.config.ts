import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Restricted Windows runners may require pre-created output directories.
  // Normal development/deployment builds retain Next's default cleanup.
  cleanDistDir: process.env.FOREST_PRESERVE_BUILD_OUTPUT !== "true",
  allowedDevOrigins: ["localhost", "127.0.0.1", "192.168.56.1"],
  outputFileTracingIncludes: {
    "/api/maps": ["./public/maps/mapawa_malasag.pmtiles", "./public/maps/outpost.pmtiles"],
    "/api/maps/archive": ["./public/maps/mapawa_malasag.pmtiles", "./public/maps/outpost.pmtiles"],
  },
  outputFileTracingExcludes: {
    "*": ["./data/**", "./receiver/**", "./.env.receiver.local"],
  },
};

export default nextConfig;
