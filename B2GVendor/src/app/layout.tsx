import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import { AppProvider } from "@/context/AppContext";

const geistSans = Geist({
  variable: "--font-geist-sans",
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
    <html lang="th" className={`${geistSans.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-white text-slate-900">
        <AppProvider>
          {children}
        </AppProvider>
      </body>
    </html>
  );
}
