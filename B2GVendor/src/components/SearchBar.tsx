'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search, X, Sparkles, ArrowRight } from 'lucide-react';
import { useApp } from '@/context/AppContext';

interface SearchBarProps {
  placeholder?: string;
  size?: 'normal' | 'large';
  autoFocus?: boolean;
}

function SearchBarForm({ placeholder, size = 'normal', autoFocus = false }: SearchBarProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { lang, tags } = useApp();

  const initialQuery = searchParams.get('q') || '';
  const [query, setQuery] = useState(initialQuery);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [typoNotice, setTypoNotice] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    setQuery(searchParams.get('q') || '');
  }, [searchParams]);

  const handleInputChange = (val: string) => {
    setQuery(val);

    if (!val.trim()) {
      setSuggestions([]);
      setTypoNotice(null);
      return;
    }

    const valLower = val.toLowerCase().trim();
    const matchedSuggestions: string[] = [];
    let detectedTypoCorrection: string | null = null;

    tags.forEach(tag => {
      if (tag.name.toLowerCase().includes(valLower)) {
        matchedSuggestions.push(tag.name);
      }
      tag.aliases.forEach(alias => {
        if (alias.toLowerCase().includes(valLower)) {
          matchedSuggestions.push(`${alias} → ${tag.name}`);
        }
      });
    });

    if (valLower === 'ยโธา' || valLower === 'โยธาถนน') {
      detectedTypoCorrection = 'โยธา (งานก่อสร้างและโยธา)';
    } else if (valLower === 'คอมพิเตอร์' || valLower === 'ไอที') {
      detectedTypoCorrection = 'ครุภัณฑ์คอมพิวเตอร์และดิจิทัล';
    }

    setTypoNotice(detectedTypoCorrection);
    setSuggestions(Array.from(new Set(matchedSuggestions)).slice(0, 5));
  };

  const executeSearch = (targetQuery?: string) => {
    const qToUse = targetQuery !== undefined ? targetQuery : query;
    const params = new URLSearchParams(searchParams.toString());
    if (qToUse.trim()) {
      params.set('q', qToUse.trim());
    } else {
      params.delete('q');
    }
    params.delete('page');
    router.push(`/search?${params.toString()}`);
    setSuggestions([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      executeSearch();
    }
    if (e.key === 'Escape') {
      setSuggestions([]);
    }
  };

  const defaultPlaceholder = lang === 'en'
    ? 'Search procurement works, TOR specs, agency names (e.g. ถนน, CCTV, โยธา)...'
    : 'ค้นหาโครงการจัดซื้อจัดจ้าง, เอกสาร TOR, ชื่อหน่วยงาน (เช่น ถนน, CCTV, โยธา)...';

  return (
    <div className="relative w-full">
      <div
        className={`relative flex items-center w-full rounded-2xl bg-white border transition-all duration-200 ${
          focused ? 'border-emerald-500 ring-4 ring-emerald-500/10' : 'border-slate-200'
        } ${size === 'large' ? 'py-3 px-5' : 'py-2 px-3.5'}`}
      >
        <Search className={`text-emerald-600 shrink-0 mr-3 ${size === 'large' ? 'w-6 h-6' : 'w-5 h-5'}`} />
        <input
          type="text"
          value={query}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          autoFocus={autoFocus}
          placeholder={placeholder || defaultPlaceholder}
          className={`w-full bg-transparent outline-hidden text-slate-900 placeholder-slate-400 ${
            size === 'large' ? 'text-base sm:text-lg' : 'text-sm sm:text-base'
          }`}
        />

        {query && (
          <button
            onClick={() => {
              setQuery('');
              setSuggestions([]);
              setTypoNotice(null);
            }}
            className="p-1 text-slate-400 hover:text-slate-600 mr-1 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        )}

        <button
          onClick={() => executeSearch()}
          className={`inline-flex items-center gap-1.5 font-semibold rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 transition-colors duration-150 shrink-0 ${
            size === 'large' ? 'px-5 py-2.5 text-sm sm:text-base' : 'px-3.5 py-1.5 text-sm'
          }`}
        >
          <span>{lang === 'en' ? 'Search' : 'ค้นหา'}</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>

      {typoNotice && (
        <div className="mt-2 flex items-center gap-2 text-xs text-amber-800 bg-amber-50 px-3 py-1.5 rounded-lg border border-amber-200 animate-fade-in">
          <Sparkles className="w-4 h-4 text-amber-600 shrink-0" />
          <span>{lang === 'en' ? 'Did you mean:' : 'คุณหมายถึง:'} <strong>{typoNotice}</strong></span>
          <button
            onClick={() => {
              setQuery(typoNotice.split(' ')[0]);
              executeSearch(typoNotice.split(' ')[0]);
            }}
            className="ml-auto underline font-medium text-amber-900"
          >
            {lang === 'en' ? 'Apply' : 'ใช้คำนี้'}
          </button>
        </div>
      )}

      {suggestions.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-xl border border-slate-200 shadow-lg z-50 overflow-hidden animate-fade-in-up">
          <div className="p-2 text-xs font-semibold uppercase tracking-wider text-slate-400 border-b border-slate-100">
            {lang === 'en' ? 'Suggested Tags & Aliases' : 'แท็กและคำค้นหาใกล้เคียง'}
          </div>
          {suggestions.map((item, idx) => (
            <button
              key={idx}
              onClick={() => {
                const cleanItem = item.includes('→') ? item.split('→')[1].trim() : item;
                setQuery(cleanItem);
                executeSearch(cleanItem);
              }}
              className="w-full text-left px-4 py-2.5 text-sm text-slate-700 hover:bg-emerald-50 hover:text-emerald-700 flex items-center justify-between transition-colors"
            >
              <span>{item}</span>
              <span className="text-xs text-slate-400">{lang === 'en' ? 'Search tag' : 'ค้นหาตามแท็ก'}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function SearchBar(props: SearchBarProps) {
  return <SearchBarForm {...props} />;
}
