'use client';

import React from 'react';
import { Navbar } from './Navbar';
import { Footer } from './Footer';

export function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 animate-fade-in">
        {children}
      </main>
      <Footer />
    </div>
  );
}
