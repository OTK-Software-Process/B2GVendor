import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AppProvider } from "@/context/AppContext";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "B2G Vendor — ระบบจัดซื้อจัดจ้างภาครัฐ",
  description: "ศูนย์รวมข้อมูลโครงการจัดซื้อจัดจ้างจากหน่วยงานภาครัฐหลายแห่ง และการแจ้งเตือนตามแท็กความสนใจ",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="th" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-white text-slate-900">
        <AppProvider>
          {children}
        </AppProvider>
      </body>
    </html>
  );
}
