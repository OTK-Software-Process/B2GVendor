'use client';

import React from 'react';
import { TORFile } from '@/lib/mock-data';
import { EgpPageLink } from '@/lib/egp';
import { EgpPageLinks } from './EgpPageLinks';
import { useApp } from '@/context/AppContext';
import { FileText, Download, ExternalLink } from 'lucide-react';

interface TORDownloadListProps {
  files: TORFile[];
  // The work's own page(s) on e-GP2 and its project number -- the "open on the
  // government site" link sits at the top of the TOR section.
  egpPages?: EgpPageLink[];
  projectId?: string;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export function TORDownloadList({ files, egpPages = [], projectId }: TORDownloadListProps) {
  const { lang } = useApp();

  // Every TOR links back to where the government published it. A file we host a
  // copy of gets that as a second link (an external-only entry's main button
  // already goes there); the several files of one zip share a source, so the
  // link is shown once, on the first of them.
  const seenSources = new Set<string>();
  const showOrigin = files.map(file => {
    if (!file.sourceUrl || file.external || seenSources.has(file.sourceUrl)) return false;
    seenSources.add(file.sourceUrl);
    return true;
  });

  return (
    <div className="bg-slate-50 rounded-2xl p-5 border border-slate-200 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText className="w-5 h-5 text-emerald-600" />
          <h3 className="font-bold text-slate-900">
            {lang === 'en' ? 'TOR Specifications & Attachments' : 'เอกสารประกวดราคาและข้อกำหนด TOR'}
          </h3>
        </div>
      </div>

      <EgpPageLinks links={egpPages} projectId={projectId} />

      <div className="divide-y divide-slate-200">
        {files.map((file, index) => {
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
                  {showOrigin[index] && file.sourceUrl && (
                    <a
                      href={file.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-medium text-sky-700 hover:underline mt-0.5"
                    >
                      <ExternalLink className="w-3 h-3 shrink-0" />
                      <span>{lang === 'en' ? 'Original TOR on' : 'ดู TOR ต้นฉบับที่'} {hostOf(file.sourceUrl)}</span>
                    </a>
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
