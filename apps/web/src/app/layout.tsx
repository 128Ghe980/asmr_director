import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI ASMR 导演台",
  description: "可编辑双耳 ASMR 时间线的导演工作台。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
