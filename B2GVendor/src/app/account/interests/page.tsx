'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { PublicShell } from '@/components/PublicShell';
import { FollowTagButton } from '@/components/FollowTagButton';
import { useApp } from '@/context/AppContext';
import { Bookmark, Search, Tag, X, Check, Sparkles, Filter } from 'lucide-react';

export default function AccountInterestsPage() {
  const { lang, tags, followedTagIds, toggleFollowTag } = useApp();
  const [activeFacet, setActiveFacet] = useState<'all' | 'site' | 'category' | 'agency' | 'method' | 'keyword'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const followedTags = tags.filter(t => followedTagIds.includes(t.id));

  // Filter tag taxonomy
  const filteredTags = tags.filter(t => {
    if (activeFacet !== 'all' && t.facet !== activeFacet) return false;
    if (searchQuery) {
      const qLower = searchQuery.toLowerCase();
      const matchName = t.name.toLowerCase().includes(qLower);
      const matchAlias = t.aliases.some(a => a.toLowerCase().includes(qLower));
      if (!matchName && !matchAlias) return false;
    }
    return true;
  });

  return (
    <PublicShell>
      <div className="space-y-8 pb-12">
        {/* Header & Sub-Nav */}
        <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-extrabold text-slate-900 flex items-center gap-2">
              <Bookmark className="w-6 h-6 text-emerald-600" />
              <span>{lang === 'en' ? 'My Followed Tags & Interests' : 'จัดการแท็กที่ติดตามและหมวดหมู่ความสนใจ'}</span>
            </h1>
            <p className="text-xs text-slate-500 mt-1">
              {lang === 'en' ? 'Browse taxonomy by facet, see synonyms/aliases resolve to canonical tags' : 'เลือกติดตามแท็กหมวดหมู่เพื่อรับการแจ้งเตือน รองรับการเชื่อมโยงคำพ้องความหมาย (Aliases)'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
            <Link href="/account" className="px-3.5 py-2 rounded-xl bg-slate-100 text-slate-700 hover:bg-emerald-50">
              {lang === 'en' ? 'Profile' : 'ข้อมูลส่วนตัว'}
            </Link>
            <Link href="/account/interests" className="px-3.5 py-2 rounded-xl bg-emerald-600 text-white shadow-2xs">
              {lang === 'en' ? 'Interests' : 'แท็กที่ติดตาม'}
            </Link>
            <Link href="/account/notifications" className="px-3.5 py-2 rounded-xl bg-slate-100 text-slate-700 hover:bg-emerald-50">
              {lang === 'en' ? 'Notifications' : 'การแจ้งเตือน'}
            </Link>
          </div>
        </div>

        {/* Currently Followed Tags Bar */}
        <div className="bg-emerald-50 border border-emerald-200 rounded-3xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-base text-emerald-900 flex items-center gap-2">
              <Check className="w-5 h-5 text-emerald-600" />
              <span>{lang === 'en' ? 'Currently Followed Tags' : 'แท็กที่คุณกำลังติดตามอยู่ขณะนี้'}</span>
            </h3>
            <span className="text-xs font-extrabold bg-emerald-600 text-white px-2.5 py-0.5 rounded-full">
              {followedTags.length} {lang === 'en' ? 'tags' : 'แท็ก'}
            </span>
          </div>

          {followedTags.length === 0 ? (
            <p className="text-xs text-slate-500 italic">
              {lang === 'en' ? 'You are not following any tags yet. Browse below to follow tags.' : 'คุณยังไม่ได้ติดตามแท็กใดๆ เลือกแท็กด้านล่างเพื่อเริ่มรับการแจ้งเตือน'}
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {followedTags.map(tag => (
                <div key={tag.id} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white border border-emerald-300 shadow-2xs text-xs font-semibold text-slate-900">
                  <span>#{tag.name}</span>
                  <button
                    onClick={() => toggleFollowTag(tag.id)}
                    className="text-slate-400 hover:text-rose-600 transition-colors p-0.5"
                    title={lang === 'en' ? 'Unfollow' : 'ยกเลิกการติดตาม'}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Taxonomy Browser */}
        <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Tag className="w-5 h-5 text-emerald-600" />
              <h2 className="font-bold text-lg text-slate-900">
                {lang === 'en' ? 'Browse Tag Taxonomy by Facet' : 'ค้นพบแท็กตามหมวดหมู่ (Taxonomy Browsing)'}
              </h2>
            </div>

            {/* Facet Tabs */}
            <div className="flex flex-wrap gap-1.5 text-xs font-semibold">
              {(['all', 'site', 'category', 'agency', 'method', 'keyword'] as const).map(facet => (
                <button
                  key={facet}
                  onClick={() => setActiveFacet(facet)}
                  className={`px-3 py-1.5 rounded-xl transition-all capitalize ${
                    activeFacet === facet
                      ? 'bg-emerald-600 text-white shadow-2xs'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {facet === 'all' ? (lang === 'en' ? 'All Facets' : 'ทั้งหมด') : facet}
                </button>
              ))}
            </div>
          </div>

          {/* Search Box */}
          <div className="relative flex items-center rounded-2xl bg-slate-50 border border-slate-200 px-4 py-2">
            <Search className="w-4 h-4 text-slate-400 mr-2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={lang === 'en' ? 'Type keyword or alias (e.g., "โยธา", "คอมพิวเตอร์", "CCTV")...' : 'ค้นหาแท็กหรือคำพ้องความหมาย (เช่น "โยธา", "คอมพิวเตอร์", "CCTV")...'}
              className="w-full bg-transparent outline-hidden text-xs text-slate-900"
            />
          </div>

          {/* Tag Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredTags.map(tag => (
              <div key={tag.id} className="p-4 rounded-2xl border border-slate-200 hover:border-emerald-500 transition-all flex items-start justify-between gap-4 bg-slate-50/50">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono font-bold uppercase text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-md">
                      {tag.facet}
                    </span>
                    <span className="text-xs text-slate-400">{tag.worksCount} โครงการ</span>
                  </div>

                  <h4 className="font-bold text-sm text-slate-900">#{tag.name}</h4>

                  {/* Alias / Synonym Resolution display */}
                  <div className="flex flex-wrap items-center gap-1 text-[11px] text-slate-500">
                    <Sparkles className="w-3 h-3 text-amber-500 shrink-0" />
                    <span>คำพ้อง (Aliases): {tag.aliases.join(', ')}</span>
                  </div>
                </div>

                <FollowTagButton tagId={tag.id} tagName={tag.name} variant="button" size="sm" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </PublicShell>
  );
}
