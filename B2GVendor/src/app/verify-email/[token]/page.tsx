"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { PublicShell } from "@/components/PublicShell";
import { useApp } from "@/context/AppContext";
import { api } from "@/lib/api";
import { CheckCircle2, ShieldCheck, ArrowRight } from "lucide-react";

export default function VerifyEmailPage() {
  const { lang } = useApp();
  const { token } = useParams<{ token: string }>();
  const [status, setStatus] = useState<"verifying" | "verified" | "error">("verifying");
  const verificationStarted = useRef<string | null>(null);

  useEffect(() => {
    if (verificationStarted.current === token) return;
    verificationStarted.current = token;

    api
      .post<{ emailVerified: boolean }>("/auth/verify-email", { token })
      .then(() => setStatus("verified"))
      .catch(() => setStatus("error"));
  }, [token]);

  return (
    <PublicShell>
      <div className="max-w-md mx-auto py-8 text-center space-y-6">
        <div className="bg-white border border-slate-200 rounded-3xl p-8 shadow-xs space-y-6">
          {status === "verifying" ? (
            <div className="space-y-4 py-4">
              <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto animate-spin">
                <ShieldCheck className="w-6 h-6" />
              </div>
              <h2 className="text-lg font-bold text-slate-900">
                {lang === "en"
                  ? "Verifying your email token..."
                  : "กำลังตรวจสอบการยืนยันอีเมล..."}
              </h2>
            </div>
          ) : status === "verified" ? (
            <div className="space-y-4 py-4">
              <CheckCircle2 className="w-16 h-16 text-emerald-600 mx-auto" />
              <h1 className="text-2xl font-extrabold text-slate-900">
                {lang === "en"
                  ? "Email Verified Successfully!"
                  : "ยืนยันอีเมลสำเร็จเรียบร้อย!"}
              </h1>
              <p className="text-xs text-slate-500">
                {lang === "en"
                  ? "Your email is verified. Sign in to follow tags and manage notifications."
                  : "ยืนยันอีเมลแล้ว กรุณาเข้าสู่ระบบเพื่อติดตามแท็กและตั้งค่าการรับข่าวสาร"}
              </p>
              <div className="pt-2">
                <Link
                  href="/login"
                  className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm transition-colors"
                >
                  <span>
                    {lang === "en"
                      ? "Go to Log In"
                      : "ไปที่หน้าเข้าสู่ระบบ"}
                  </span>
                  <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            </div>
          ) : (
            <div className="space-y-4 py-4">
              <ShieldCheck className="w-16 h-16 text-rose-500 mx-auto" />
              <h1 className="text-2xl font-extrabold text-slate-900">
                {lang === "en" ? "Verification link is invalid" : "ลิงก์ยืนยันไม่ถูกต้อง"}
              </h1>
              <p className="text-xs text-slate-500">
                {lang === "en"
                  ? "This link may have expired or already been used. Sign in if your email is already verified."
                  : "ลิงก์นี้อาจหมดอายุหรือถูกใช้ไปแล้ว หากยืนยันอีเมลแล้ว กรุณาเข้าสู่ระบบ"}
              </p>
              <Link
                href="/login"
                className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm transition-colors"
              >
                <span>{lang === "en" ? "Go to Log In" : "ไปที่หน้าเข้าสู่ระบบ"}</span>
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          )}
        </div>
      </div>
    </PublicShell>
  );
}
