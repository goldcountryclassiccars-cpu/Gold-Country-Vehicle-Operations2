import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "GCCC Ops", template: "%s · GCCC Ops" },
  description: "Gold Country Classic Cars — Vehicle Operations Platform",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
