'use client';

import React from 'react';
import { TORFile } from '@/lib/mock-data';
import { useApp } from '@/context/AppContext';
import { FileText, Download, ExternalLink, ShieldCheck } from 'lucide-react';

interface TORDownloadListProps {
  files: TORFile[];
}

export function TORDownloadList({ files }: TORDownloadListProps) {
  const { lang } = useApp();

  return (
    <div className="bg-slate-50 rounded-2xl p-5 border border-slate-200 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText className="w-5 h-5 text-emerald-600" />
          <h3 className="font-bold text-slate-900">
            {lang === 'en' ? 'TOR Specifications & Attachments' : 'เอกสารประกวดราคาและข้อกำหนด TOR'}
          </h3>
        </div>
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-100 px-2.5 py-1 rounded-full">
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>HTTPS</span>
        </span>
      </div>

      <div className="divide-y divide-slate-200">
        {files.map(file => {
          const isExternalReference = Boolean(file.external);

          return (
            <div key={file.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-[10px] shrink-0">
                  {file.type}
                </div>
                <div className="min-w-0">
                  <a
                    href={file.url}
                    target={isExternalReference ? '_blank' : undefined}
                    rel={isExternalReference ? 'noopener noreferrer' : undefined}
                    className="text-sm font-semibold text-slate-900 hover:text-emerald-600 transition-colors truncate block"
                  >
                    {file.name}
                  </a>
                  {file.date && (
                    <div className="flex items-center gap-3 text-xs text-slate-400 mt-0.5">
                      <span>{lang === 'en' ? 'Downloaded:' : 'ดาวน์โหลดเมื่อ:'} {file.date}</span>
                    </div>
                  )}
                </div>
              </div>

              <a
                href={file.url}
                target={isExternalReference ? '_blank' : undefined}
                rel={isExternalReference ? 'noopener noreferrer' : undefined}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-xl bg-white border border-slate-200 text-slate-700 hover:border-emerald-500 hover:text-emerald-600 transition-all shadow-2xs cursor-pointer shrink-0"
              >
                {isExternalReference ? (
                  <>
                    <ExternalLink className="w-3.5 h-3.5 text-emerald-600" />
                    <span>{lang === 'en' ? 'View on source site' : 'ดูที่เว็บไซต์ต้นทาง'}</span>
                  </>
                ) : (
                  <>
                    <Download className="w-3.5 h-3.5 text-emerald-600" />
                    <span>{lang === 'en' ? 'Download' : 'ดาวน์โหลด'}</span>
                  </>
                )}
              </a>
            </div>
          );
        })}
      </div>
    </div>
  );
}
