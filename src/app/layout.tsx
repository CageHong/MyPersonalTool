import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "personal-tools",
  description: "個人工具平台",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
