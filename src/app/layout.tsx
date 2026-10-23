import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "LiaraPilot — ایجنت خودکار DevOps و SRE",
  description:
    "برنامه‌ریزی استقرار مبتنی بر شواهد، عملیات با دروازهٔ تأیید و پاسخ به‌صرفه به حوادث برای اپلیکیشن‌های روی سکوی ابری لیارا.",
  keywords: ["Liara", "لیارا", "DevOps", "SRE", "استقرار", "ایجنت", "گیت‌هاب", "گیت‌لب", "ChatGPT"],
  icons: {
    icon: "/logo.svg",
  },
};

export const viewport: Viewport = {
  themeColor: "#0c1210",
};

// Applies the saved locale before first paint (no RTL/LTR flash).
const localeBootstrap = `try{var l=localStorage.getItem('lp_locale');if(l==='en'){document.documentElement.lang='en';document.documentElement.dir='ltr';}else{document.documentElement.lang='fa';document.documentElement.dir='rtl';}}catch(e){}`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fa" dir="rtl" className="dark" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased bg-background text-foreground`}
      >
        <script dangerouslySetInnerHTML={{ __html: localeBootstrap }} />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
