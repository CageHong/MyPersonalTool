import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 正式版使用獨立的建置輸出資料夾（例如 .next-prod），避免與開發版的 .next 互相覆寫
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  // packages/ 的套件直接匯出 TypeScript 原始碼,Next.js 要自己轉譯
  transpilePackages: ["@personal-tools/statement-parsers"],
};

export default nextConfig;
