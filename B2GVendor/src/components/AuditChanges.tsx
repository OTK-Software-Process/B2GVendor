'use client';

import React from 'react';
import { Lock } from 'lucide-react';
import type { AppLang } from '@/context/AppContext';
import type { BackendAuditChange } from '@/lib/backend';

// Generic before/after viewer for an audit entry. It knows nothing about
// accounts, tags or works: it renders whatever `changes` it is given (a field
// path with a before and an after), so a newly audited entity needs no change
// here. Missing sides read "(none)", masked secrets read "Hidden", arrays show
// what was added and removed, and anything structured falls back to JSON.

const REDACTED = '[REDACTED]';
const isPrimitive = (v: unknown): v is string | number | boolean | null => v === null || ['string', 'number', 'boolean'].includes(typeof v);

function Chip({ children, tone }: { children: React.ReactNode; tone: 'plain' | 'added' | 'removed' }) {
  const style =
    tone === 'added'
      ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
      : tone === 'removed'
        ? 'bg-rose-50 border-rose-300 text-rose-900 line-through'
        : 'bg-slate-100 border-slate-200 text-slate-700';
  return <span className={`inline-block max-w-full break-words text-[11px] rounded-full border px-2 py-0.5 ${style}`}>{children}</span>;
}

function Scalar({ value, lang }: { value: string | number | boolean | null; lang: AppLang }) {
  if (value === null) return <span className="text-slate-400 italic">null</span>;
  if (value === '') return <span className="text-slate-400 italic">{lang === 'en' ? '(empty text)' : '(ข้อความว่าง)'}</span>;
  if (typeof value === 'boolean') return <Chip tone="plain">{String(value)}</Chip>;
  return <span className="break-words whitespace-pre-wrap">{String(value)}</span>;
}

function ValueView({
  value,
  present,
  redacted,
  otherValue,
  side,
  lang
}: {
  value: unknown;
  present: boolean;
  redacted?: boolean;
  /** The value on the other side, used to highlight array items that were added or removed. */
  otherValue: unknown;
  side: 'before' | 'after';
  lang: AppLang;
}) {
  if (!present) return <span className="text-slate-400 italic">{lang === 'en' ? '(none)' : '(ไม่มี)'}</span>;

  if (redacted || value === REDACTED) {
    return (
      <span className="inline-flex items-center gap-1 text-slate-500" title={lang === 'en' ? 'Sensitive value, never stored in the log' : 'ข้อมูลสำคัญ ไม่ถูกเก็บในบันทึก'}>
        <Lock className="w-3 h-3" />
        {lang === 'en' ? 'Hidden (sensitive)' : 'ซ่อนไว้ (ข้อมูลสำคัญ)'}
      </span>
    );
  }

  if (isPrimitive(value)) return <Scalar value={value} lang={lang} />;

  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-slate-400 italic">{lang === 'en' ? '(empty list)' : '(รายการว่าง)'}</span>;
    if (value.every(isPrimitive)) {
      const other = Array.isArray(otherValue) ? (otherValue as unknown[]).map(String) : null;
      return (
        <span className="flex flex-wrap gap-1">
          {value.map((item, i) => {
            // An item is "changed" when it is not on the other side: added on the after side, removed on the before side.
            const changed = other !== null && !other.includes(String(item));
            return (
              <Chip key={`${String(item)}-${i}`} tone={changed ? (side === 'after' ? 'added' : 'removed') : 'plain'}>
                {String(item)}
              </Chip>
            );
          })}
        </span>
      );
    }
  }

  return (
    <pre className="text-[11px] leading-snug bg-slate-50 border border-slate-200 rounded-lg p-2 max-h-40 overflow-auto whitespace-pre-wrap break-words">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

export function AuditChanges({ changes, lang }: { changes: BackendAuditChange[]; lang: AppLang }) {
  if (changes.length === 0) {
    return (
      <p className="text-xs text-slate-500">
        {lang === 'en' ? 'No field-level changes were recorded for this event.' : 'เหตุการณ์นี้ไม่มีการบันทึกการเปลี่ยนแปลงระดับฟิลด์'}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto border border-slate-200 rounded-xl bg-white">
      <table className="w-full text-xs text-left">
        <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200">
          <tr>
            <th className="px-3 py-2 w-1/4">{lang === 'en' ? 'Field' : 'ฟิลด์'}</th>
            <th className="px-3 py-2 w-3/8">{lang === 'en' ? 'Before' : 'ก่อน'}</th>
            <th className="px-3 py-2 w-3/8">{lang === 'en' ? 'After' : 'หลัง'}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 align-top">
          {changes.map(change => {
            const hasBefore = 'before' in change;
            const hasAfter = 'after' in change;
            return (
              <tr key={change.path}>
                <td className="px-3 py-2 font-mono text-[11px] text-slate-700 break-all">{change.path}</td>
                <td className="px-3 py-2 text-slate-700">
                  <ValueView value={change.before} present={hasBefore} redacted={change.redacted} otherValue={change.after} side="before" lang={lang} />
                </td>
                <td className="px-3 py-2 text-slate-900">
                  <ValueView value={change.after} present={hasAfter} redacted={change.redacted} otherValue={change.before} side="after" lang={lang} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Keys the log adds to every automatic entry; they say how, not what.
const HIDDEN_METADATA = new Set(['source', 'operation', 'model']);

function MetadataValue({ value, lang }: { value: unknown; lang: AppLang }) {
  if (isPrimitive(value)) return <Scalar value={value} lang={lang} />;
  // A list of things that have a name (e.g. the tags added to a work) reads best as chips.
  if (Array.isArray(value) && value.every(v => typeof v === 'object' && v !== null && ('name' in v || 'id' in v))) {
    if (value.length === 0) return <span className="text-slate-400 italic">{lang === 'en' ? '(none)' : '(ไม่มี)'}</span>;
    return (
      <span className="flex flex-wrap gap-1">
        {value.map((v, i) => (
          <Chip key={i} tone="plain">
            {String((v as { name?: unknown; id?: unknown }).name ?? (v as { id?: unknown }).id)}
          </Chip>
        ))}
      </span>
    );
  }
  return <pre className="text-[11px] bg-slate-50 border border-slate-200 rounded-lg p-2 max-h-32 overflow-auto whitespace-pre-wrap break-words">{JSON.stringify(value, null, 2)}</pre>;
}

export function AuditMetadata({ metadata, lang }: { metadata?: Record<string, unknown>; lang: AppLang }) {
  const entries = Object.entries(metadata ?? {}).filter(([key]) => !HIDDEN_METADATA.has(key));
  if (entries.length === 0) return null;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
      {entries.map(([key, value]) => (
        <React.Fragment key={key}>
          <dt className="font-semibold text-slate-500">{key}</dt>
          <dd className="text-slate-800 min-w-0">
            <MetadataValue value={value} lang={lang} />
          </dd>
        </React.Fragment>
      ))}
    </dl>
  );
}
