'use client';

import React from 'react';

export function LoadingSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-4">
      {Array.from({ length: count }).map((_, idx) => (
        <div key={idx} className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3 animate-pulse">
          <div className="flex items-center justify-between">
            <div className="h-6 w-28 bg-slate-100 rounded-full" />
            <div className="h-6 w-32 bg-slate-100 rounded-lg" />
          </div>
          <div className="h-6 w-3/4 bg-slate-100 rounded-lg" />
          <div className="h-4 w-1/2 bg-slate-100 rounded-lg" />
          <div className="flex gap-2 pt-2">
            <div className="h-5 w-20 bg-slate-100 rounded-full" />
            <div className="h-5 w-24 bg-slate-100 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}
