import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // CV parsers run only on the server.
  serverExternalPackages: ["unpdf", "mammoth"],
  // rubric.txt is read at seed time and by the local store.
  outputFileTracingIncludes: { "/**": ["./rubric.txt"] },
  experimental: { serverActions: { bodySizeLimit: "4mb" } },
};

export default nextConfig;
