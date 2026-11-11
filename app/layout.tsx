import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { getActiveTenantConfig } from "@/lib/tenants";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export function generateMetadata(): Metadata {
  const t = getActiveTenantConfig();
  return { title: `${t.productName} — Conversational Analytics`, description: t.metaDescription };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const theme = getActiveTenantConfig().theme; // D-050: "default" renders exactly as before; "navy" is harborline's token override
  return (
    <html lang="en" className={inter.variable} data-theme={theme}>
      <body className={`${inter.className} antialiased`}>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
