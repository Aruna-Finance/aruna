import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Aruna Check",
  description:
    "Paste a NEAR account and see whether its contract can still change, with the evidence.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600&family=JetBrains+Mono:wght@400;500&family=Newsreader:ital,wght@1,400&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
