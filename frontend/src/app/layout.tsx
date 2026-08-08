import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { Inter, JetBrains_Mono, Newsreader } from "next/font/google";
import { Providers } from "./providers";
import "./globals.css";

const newsreader = Newsreader({
  subsets: ["latin"],
  variable: "--font-newsreader",
  weight: ["400", "500", "600"],
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "TUNTAS — Capability Assurance OS",
  description: "Turns training spend into provable regulatory readiness.",
  icons: {
    icon: [
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${newsreader.variable} ${inter.variable} ${jetbrains.variable} h-full`}
    >
      <body className="min-h-full antialiased">
        <Providers>{children}</Providers>
        <Analytics />
      </body>
    </html>
  );
}
