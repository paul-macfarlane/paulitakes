import type { Metadata, Viewport } from "next";
import { Barlow_Condensed, Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

// Fail fast on invalid configuration (validated once, server-only).
import { env } from "@/lib/shared/env";

import { ThemeProvider } from "@/components/theme-provider";

// Loads the font files; globals.css references the resulting family names
// literally in @theme inline (which can't resolve runtime CSS variables).
// Swapping fonts means updating globals.css too.
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const barlowCondensed = Barlow_Condensed({
  variable: "--font-barlow-condensed",
  subsets: ["latin"],
  // 800 covers @tailwindcss/typography's prose-h1 weight so user-authored
  // markdown headings don't get faux-bold synthesis.
  weight: ["500", "600", "700", "800"],
});

// next-themes' in-app toggle stamps a class on <html>, but the OS-level
// theme-color meta tag can only track the system scheme via media query —
// acceptable drift for users who override the system theme.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafcfe" },
    { media: "(prefers-color-scheme: dark)", color: "#070b11" },
  ],
};

export const metadata: Metadata = {
  // BETTER_AUTH_URL is the app's own origin, so it doubles as the canonical
  // base for absolute OG/social URLs.
  metadataBase: new URL(env.BETTER_AUTH_URL),
  title: {
    default: "Paulitakes",
    template: "%s · Paulitakes",
  },
  description:
    "Sports analysis, storytelling, and cheap laughs from Paul and guest authors. Taking sports seriously, and ourselves a little less so.",
  openGraph: {
    siteName: "Paulitakes",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // suppressHydrationWarning: next-themes stamps the theme class on <html>
    // before hydration.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${barlowCondensed.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
