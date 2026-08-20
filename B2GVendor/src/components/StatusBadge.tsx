'use client';

import React from 'react';
import { ProcurementStatus, MOCK_STATUS_CONFIG } from '@/lib/mock-data';
import { useApp } from '@/context/AppContext';

interface StatusBadgeProps {
  status: ProcurementStatus;
  size?: 'sm' | 'md' | 'lg';
}

export function StatusBadge({ status, size = 'md' }: StatusBadgeProps) {
  const { lang } = useApp();
  const config = MOCK_STATUS_CONFIG[status] || MOCK_STATUS_CONFIG.INVITATION;
  const label = lang === 'en' ? config.labelEn : config.label;

  const sizeClasses = {
    sm: 'text-[11px] px-2 py-0.5 font-semibold',
    md: 'text-xs sm:text-sm px-2.5 py-1 font-bold',
    lg: 'text-sm sm:text-base px-3.5 py-1.5 font-bold'
  };

  const dotSize = size === 'lg' ? 'w-2 h-2' : 'w-1.5 h-1.5';

  return (
    <span className="inline-flex items-center gap-2" title={label}>
      <span className={`relative inline-flex shrink-0 ${dotSize}`}>
        <span className={`absolute inline-flex w-full h-full rounded-full opacity-60 animate-ping ${config.dotClass}`} />
        <span className={`relative inline-flex rounded-full ${dotSize} ${config.dotClass}`} />
      </span>
      <span className={`inline-flex rounded-md tracking-wide ${config.boxClass} ${sizeClasses[size]}`}>
        {label}
      </span>
    </span>
  );
}
