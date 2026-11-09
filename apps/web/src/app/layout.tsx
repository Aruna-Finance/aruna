import type { Metadata } from "next";
import "@fontsource/ibm-plex-sans/300.css";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./globals.css";
import { SmoothScroll } from "@/shared/SmoothScroll";
import { Toaster } from "@/shared/Toaster";

export const metadata: Metadata = {
  title: "Aruna Check",
  description:
    "Paste a NEAR account and see whether its contract can still change, with the evidence.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <SmoothScroll />
        <Toaster />
      </body>
    </html>
  );
}
