import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // packages/ 的套件直接匯出 TypeScript 原始碼,Next.js 要自己轉譯
  transpilePackages: ["@personal-tools/statement-parsers"],
};

export default nextConfig;
