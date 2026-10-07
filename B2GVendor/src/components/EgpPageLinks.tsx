'use client';

import React, { useEffect, useState } from 'react';
import { Check, Copy, ExternalLink } from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { EgpPageLink, egpSearchUrl, egpTemplateLabel } from '@/lib/egp';

interface EgpPageLinksProps {
  // The announcement page(s) e-GP itself linked for this work (may be empty).
  links: EgpPageLink[];
  // The e-GP project number. The main button searches e-GP for it; it is also
  // shown (with a copy button) so a vendor can paste it into e-GP themselves.
  projectId?: string;
}

const buttonClass =
  'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-xl border transition-colors';

// Copies text to the clipboard. The async Clipboard API is tried first; it is
// missing on a page that isn't a secure context (plain http on a real host) and
// can be refused by a permission policy, so the older execCommand route is the
// fallback. Resolves false when neither works.
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // fall through to the fallback
  }
  try {
    const field = document.createElement('textarea');
    field.value = text;
    field.setAttribute('readonly', '');
    field.style.position = 'fixed';
    field.style.opacity = '0';
    document.body.appendChild(field);
    field.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(field);
    return ok;
  } catch {
    return false;
  }
}

// "Find on e-GP": the government's own site for this work, from the TOR section.
// The main link searches e-GP's announcement page for the project number; where
// e-GP also gave us the announcement page itself, that is offered as well.
export function EgpPageLinks({ links, projectId }: EgpPageLinksProps) {
  const { lang } = useApp();
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');

  useEffect(() => {
    if (copyState === 'idle') return;
    const timer = setTimeout(() => setCopyState('idle'), 2500);
    return () => clearTimeout(timer);
  }, [copyState]);

  const searchUrl = egpSearchUrl(projectId);
  if (!searchUrl && links.length === 0) return null;

  const en = lang === 'en';
  const several = links.length > 1;
  const kindLabel = links.length > 0 ? egpTemplateLabel(links[0].templateType, en ? 'en' : 'th') : '';

  const copyProjectNumber = async (): Promise<void> => {
    setCopyState((await copyText(projectId ?? '')) ? 'copied' : 'failed');
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {searchUrl && (
          <a
            href={searchUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`${buttonClass} bg-sky-50 border-sky-200 text-sky-700 hover:bg-sky-100`}
          >
            <ExternalLink className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span>{en ? 'Find this project on e-GP' : 'ค้นหาโครงการนี้บน e-GP'}</span>
          </a>
        )}

        {links.length > 0 && (
          <>
            <span className="text-xs font-semibold text-slate-500">
              {en ? 'Announcement on e-GP2' : 'ประกาศบน e-GP2'}
              {kindLabel && ` (${kindLabel})`}:
            </span>
            {links.map(link => (
              <a
                key={link.url}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className={`${buttonClass} bg-white border-slate-200 text-slate-700 hover:border-sky-300 hover:text-sky-700`}
              >
                <ExternalLink className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>{several ? `${en ? 'No.' : 'ลำดับที่'} ${link.seqNo}` : en ? 'Open' : 'เปิดประกาศ'}</span>
              </a>
            ))}
          </>
        )}
      </div>

      {projectId && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
          <span>
            {en ? 'e-GP project no.' : 'เลขที่โครงการ e-GP'}{' '}
            <span className="font-mono font-semibold text-slate-700 select-all">{projectId}</span>
          </span>
          <button
            type="button"
            onClick={copyProjectNumber}
            className="inline-flex items-center gap-1 font-semibold text-sky-700 hover:underline"
          >
            {copyState === 'copied' ? <Check className="w-3 h-3" aria-hidden="true" /> : <Copy className="w-3 h-3" aria-hidden="true" />}
            <span>
              {copyState === 'copied'
                ? en ? 'Copied' : 'คัดลอกแล้ว'
                : copyState === 'failed'
                  ? en ? "Couldn't copy — select the number" : 'คัดลอกไม่ได้ — เลือกเลขที่ด้วยตนเอง'
                  : en ? 'Copy' : 'คัดลอก'}
            </span>
          </button>
        </p>
      )}
    </div>
  );
}
