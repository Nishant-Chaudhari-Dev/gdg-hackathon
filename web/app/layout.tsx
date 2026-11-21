import type { Metadata, Viewport } from "next";
import { Geist_Mono } from "next/font/google";
import { AppShell } from "@/components/layout/app-shell";
import { Providers } from "@/components/layout/providers";
import { themeInitScript } from "@/components/layout/theme";
import "./globals.css";

const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "SentinelDesk · Service Desk", template: "%s · SentinelDesk" },
  description: "AI incident-triage copilot for IT helpdesks — classify, retrieve, gate, and draft grounded replies.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#1d2125" },
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistMono.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-full">
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
