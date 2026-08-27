'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useApp } from '@/context/AppContext';
import {
  Bell,
  Globe,
  User,
  ShieldAlert,
  ChevronDown,
  Menu,
  X,
  Bookmark,
  Building2,
  SlidersHorizontal,
  LogOut
} from 'lucide-react';

export function Navbar() {
  const pathname = usePathname();
  const { role, lang, setLang, unreadCount, signOut } = useApp();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const isAdminPath = pathname.startsWith('/admin');

  return (
    <header className="sticky top-0 z-40 w-full bg-white/95 backdrop-blur-md border-b border-slate-200">
      {/* Main Nav Bar */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
        {/* Brand Logo */}
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2 group">
            <Image
              src="/Logo.png"
              alt="B2G Vendor"
              width={44}
              height={44}
              priority
              className="w-11 h-11 object-contain shrink-0 transition-transform duration-200 group-hover:scale-105"
            />
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-extrabold text-lg tracking-tight text-slate-900">B2G Vendor</span>
              </div>
            </div>
          </Link>

          {/* Desktop Nav Links */}
          <nav className="hidden md:flex items-center gap-1 ml-4 text-sm font-semibold">
            <Link
              href="/"
              className={`px-3 py-2 rounded-xl transition-colors duration-150 ${
                pathname === '/' ? 'text-emerald-700 bg-emerald-50' : 'text-slate-600 hover:text-emerald-700 hover:bg-slate-50'
              }`}
            >
              {lang === 'en' ? 'Home' : 'หน้าแรก'}
            </Link>
            <Link
              href="/search"
              className={`px-3 py-2 rounded-xl transition-colors duration-150 ${
                pathname.startsWith('/search') ? 'text-emerald-700 bg-emerald-50' : 'text-slate-600 hover:text-emerald-700 hover:bg-slate-50'
              }`}
            >
              {lang === 'en' ? 'Search Works' : 'ค้นหาโครงการ'}
            </Link>
            <Link
              href="/agencies"
              className={`px-3 py-2 rounded-xl transition-colors duration-150 ${
                pathname.startsWith('/agencies') ? 'text-emerald-700 bg-emerald-50' : 'text-slate-600 hover:text-emerald-700 hover:bg-slate-50'
              }`}
            >
              {lang === 'en' ? 'Gov. Sites' : 'หน่วยงานภาครัฐ'}
            </Link>

            {/* Quick Link to Admin Shell */}
            <Link
              href="/admin"
              className={`px-3 py-2 rounded-xl transition-colors duration-150 flex items-center gap-1.5 ${
                isAdminPath ? 'text-sky-700 bg-sky-50 font-bold' : 'text-sky-700 hover:bg-sky-50'
              }`}
            >
              <ShieldAlert className="w-4 h-4" />
              <span>{lang === 'en' ? 'Admin Control' : 'ระบบผู้ดูแลระบบ'}</span>
            </Link>
          </nav>
        </div>

        {/* Right Controls */}
        <div className="flex items-center gap-3">
          {/* Language Switcher */}
          <button
            hidden
            onClick={() => setLang(lang === 'th' ? 'en' : 'th')}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold rounded-xl border border-slate-200 text-slate-600 hover:border-emerald-300 hover:text-emerald-700 transition-colors duration-150"
          >
            <Globe className="w-3.5 h-3.5 text-emerald-600" />
            <span>{lang === 'th' ? 'TH | EN' : 'EN | TH'}</span>
          </button>

          {/* User Auth / Account Dropdown */}
          {role === 'visitor' ? (
            <div className="hidden sm:flex items-center gap-2">
              <Link
                href="/login"
                className="px-4 py-2 text-sm font-semibold text-slate-600 hover:text-emerald-700 transition-colors duration-150"
              >
                {lang === 'en' ? 'Login' : 'เข้าสู่ระบบ'}
              </Link>
              <Link
                href="/register"
                className="px-4 py-2 text-sm font-semibold rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 transition-colors duration-150"
              >
                {lang === 'en' ? 'Register' : 'ลงทะเบียน'}
              </Link>
            </div>
          ) : (
            <div className="flex items-center gap-2 relative">
              {/* Notification Bell Badge */}
              <Link
                href="/account/notifications"
                className="relative p-2.5 rounded-xl border border-slate-200 text-slate-600 hover:border-emerald-300 hover:text-emerald-700 transition-colors duration-150"
                title={lang === 'en' ? 'Notification Center' : 'ศูนย์การแจ้งเตือน'}
              >
                <Bell className="w-5 h-5" />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-rose-600 text-white font-bold text-[10px] flex items-center justify-center shadow-sm animate-fade-in">
                    {unreadCount}
                  </span>
                )}
              </Link>

              {/* User Account Menu Trigger */}
              <div className="relative">
                <button
                  onClick={() => setUserMenuOpen(!userMenuOpen)}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-slate-200 hover:border-emerald-300 transition-colors duration-150"
                >
                  <div className="w-7 h-7 rounded-lg bg-emerald-600 text-white flex items-center justify-center font-bold text-xs">
                    {role === 'admin' || role === 'superadmin' ? 'AD' : 'US'}
                  </div>
                  <span className="hidden sm:inline text-sm font-semibold text-slate-700">
                    {role === 'admin' || role === 'superadmin' ? 'Admin Staff' : 'ผู้ใช้งานทั่วไป'}
                  </span>
                  <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform duration-150 ${userMenuOpen ? 'rotate-180' : ''}`} />
                </button>

                {userMenuOpen && (
                  <div
                    onMouseLeave={() => setUserMenuOpen(false)}
                    className="absolute right-0 mt-2 w-56 bg-white rounded-2xl border border-slate-200 shadow-lg py-2 z-50 divide-y divide-slate-100 animate-fade-in-up"
                  >
                    <div className="px-4 py-2">
                      <p className="text-xs text-slate-400 font-medium">{lang === 'en' ? 'Signed in as' : 'เข้าใช้งานในนาม'}</p>
                      <p className="text-sm font-bold text-slate-900 truncate">
                        {role === 'admin' || role === 'superadmin' ? 'admin@bma.go.th' : 'user@company.co.th'}
                      </p>
                    </div>

                    <div className="py-1 text-sm font-medium">
                      <Link
                        href="/account"
                        onClick={() => setUserMenuOpen(false)}
                        className="flex items-center gap-2.5 px-4 py-2 text-slate-700 hover:bg-emerald-50 hover:text-emerald-700 transition-colors"
                      >
                        <User className="w-4 h-4 text-emerald-600" />
                        <span>{lang === 'en' ? 'Profile & Business' : 'ข้อมูลบัญชีผู้ใช้'}</span>
                      </Link>
                      <Link
                        href="/account/interests"
                        onClick={() => setUserMenuOpen(false)}
                        className="flex items-center gap-2.5 px-4 py-2 text-slate-700 hover:bg-emerald-50 hover:text-emerald-700 transition-colors"
                      >
                        <Bookmark className="w-4 h-4 text-emerald-600" />
                        <span>{lang === 'en' ? 'My Followed Tags' : 'แท็กที่ติดตาม'}</span>
                      </Link>
                      <Link
                        href="/account/notifications"
                        onClick={() => setUserMenuOpen(false)}
                        className="flex items-center justify-between px-4 py-2 text-slate-700 hover:bg-emerald-50 hover:text-emerald-700 transition-colors"
                      >
                        <div className="flex items-center gap-2.5">
                          <Bell className="w-4 h-4 text-emerald-600" />
                          <span>{lang === 'en' ? 'Notifications' : 'การแจ้งเตือน'}</span>
                        </div>
                        {unreadCount > 0 && (
                          <span className="text-xs bg-rose-50 text-rose-700 font-bold px-2 py-0.5 rounded-full border border-rose-100">
                            {unreadCount}
                          </span>
                        )}
                      </Link>
                      <Link
                        href="/account/notifications/settings"
                        onClick={() => setUserMenuOpen(false)}
                        className="flex items-center gap-2.5 px-4 py-2 text-slate-700 hover:bg-emerald-50 hover:text-emerald-700 transition-colors"
                      >
                        <SlidersHorizontal className="w-4 h-4 text-emerald-600" />
                        <span>{lang === 'en' ? 'Channel Settings' : 'ตั้งค่าการรับข่าวสาร'}</span>
                      </Link>
                    </div>

                    <div className="py-1">
                      <button
                        onClick={() => {
                          void signOut();
                          setUserMenuOpen(false);
                        }}
                        className="w-full flex items-center gap-2.5 px-4 py-2 text-sm font-semibold text-rose-600 hover:bg-rose-50 transition-colors"
                      >
                        <LogOut className="w-4 h-4" />
                        <span>{lang === 'en' ? 'Log Out' : 'ออกจากระบบ'}</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Mobile Menu Toggle */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden p-2 rounded-xl border border-slate-200 text-slate-600 hover:border-emerald-300 transition-colors duration-150"
          >
            {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </div>

      {/* Mobile Drawer Menu */}
      {mobileMenuOpen && (
        <div className="md:hidden bg-white border-b border-slate-200 px-4 pt-2 pb-6 space-y-1 animate-fade-in-up">
          <Link
            href="/"
            onClick={() => setMobileMenuOpen(false)}
            className="block px-3 py-2.5 text-base font-semibold text-slate-700 hover:bg-slate-50 hover:text-emerald-700 rounded-xl transition-colors"
          >
            {lang === 'en' ? 'Home' : 'หน้าแรก'}
          </Link>
          <Link
            href="/search"
            onClick={() => setMobileMenuOpen(false)}
            className="block px-3 py-2.5 text-base font-semibold text-slate-700 hover:bg-slate-50 hover:text-emerald-700 rounded-xl transition-colors"
          >
            {lang === 'en' ? 'Search Works' : 'ค้นหาโครงการ'}
          </Link>
          <Link
            href="/agencies"
            onClick={() => setMobileMenuOpen(false)}
            className="flex items-center gap-2 px-3 py-2.5 text-base font-semibold text-slate-700 hover:bg-slate-50 hover:text-emerald-700 rounded-xl transition-colors"
          >
            <Building2 className="w-4 h-4" />
            <span>{lang === 'en' ? 'Gov. Sites' : 'หน่วยงานภาครัฐ'}</span>
          </Link>
          <Link
            href="/admin"
            onClick={() => setMobileMenuOpen(false)}
            className="flex items-center gap-2 px-3 py-2.5 text-base font-bold text-sky-700 hover:bg-sky-50 rounded-xl transition-colors"
          >
            <ShieldAlert className="w-4 h-4" />
            <span>{lang === 'en' ? 'Admin Console' : 'ระบบผู้ดูแลระบบ'}</span>
          </Link>

          {role === 'visitor' && (
            <div className="pt-3 flex flex-col gap-2">
              <Link
                href="/login"
                onClick={() => setMobileMenuOpen(false)}
                className="w-full text-center py-2.5 text-sm font-semibold border border-slate-200 rounded-xl text-slate-700"
              >
                {lang === 'en' ? 'Login' : 'เข้าสู่ระบบ'}
              </Link>
              <Link
                href="/register"
                onClick={() => setMobileMenuOpen(false)}
                className="w-full text-center py-2.5 text-sm font-semibold bg-emerald-600 text-white rounded-xl"
              >
                {lang === 'en' ? 'Register' : 'ลงทะเบียน'}
              </Link>
            </div>
          )}
        </div>
      )}
    </header>
  );
}
