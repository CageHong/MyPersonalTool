import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "tasks",
  description: "個人任務管理",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
