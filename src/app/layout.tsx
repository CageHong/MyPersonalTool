import type { Metadata } from "next";
import AppShell from "./_shell/AppShell";
import "./globals.css";

export const metadata: Metadata = {
  title: "personal-tools",
  description: "個人工具平台",
  // 圖示由 route handler 從資料夾讀(src/platform/icon.ts),換圖不用重新 build
  icons: {
    icon: { url: "/api/platform/icon", type: "image/png" },
    apple: "/api/platform/icon",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-Hant">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
