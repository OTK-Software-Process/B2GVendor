import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import { connection } from "next/server";
import { AppProvider } from "@/context/AppContext";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "B2G Vendor — ระบบจัดซื้อจัดจ้างภาครัฐ",
  description: "ศูนย์รวมข้อมูลโครงการจัดซื้อจัดจ้างจากหน่วยงานภาครัฐหลายแห่ง และการแจ้งเตือนตามแท็กความสนใจ",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Render every page per request: the Content-Security-Policy nonce (src/proxy.ts)
  // is new on each request, and Next.js can only put it on the page's scripts
  // while rendering it. A page built ahead of time would carry no nonce, and its
  // scripts would be blocked. (The public pages already rendered per request.)
  await connection();

  return (
    <html lang="th" className={`${geistSans.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-white text-slate-900">
        <AppProvider>
          {children}
        </AppProvider>
      </body>
    </html>
  );
}
