'use client';

import React, { useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useApp } from '@/context/AppContext';
import { Tag, ArrowLeft, Save, ShieldCheck, Plus, X } from 'lucide-react';

export default function WorkTagCurationPage() {
  const params = useParams();
  const { id } = params;
  const { lang, works, tags, updateWorkTags } = useApp();

  const work = works.find(w => w.id === id) || works[0];
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>(work.tags.map(t => t.id));
  const [savedNotice, setSavedNotice] = useState(false);

  const toggleTagSelection = (tagId: string) => {
    setSelectedTagIds(prev =>
      prev.includes(tagId) ? prev.filter(item => item !== tagId) : [...prev, tagId]
    );
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    updateWorkTags(work.id, selectedTagIds);
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 3000);
  };

  return (
    <div className="space-y-8">
      <Link
        href={`/works/${work.id}`}
        className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-400 hover:text-sky-700 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>{lang === 'en' ? 'Back to Work Public Detail' : 'กลับสู่หน้าประกาศโครงการสาธารณะ'}</span>
      </Link>

      {/* Header */}
      <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 space-y-4">
        <div className="flex items-center gap-2">
          <Tag className="w-6 h-6 text-sky-600" />
          <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900">
            {lang === 'en' ? 'Work Tag Curation' : 'จัดระเบียบและกำหนดแท็กในโครงการ (Curate Tags)'}
          </h1>
        </div>
        <p className="text-xs text-slate-500">
          {lang === 'en' ? `Curating tags for Work ID: ${work.id} — ${work.title}` : `แก้ไขแท็กสำหรับโครงการ: ${work.title}`}
        </p>
      </div>

      {savedNotice && (
        <div className="bg-emerald-50 text-emerald-700 border border-emerald-200 p-4 rounded-2xl text-xs font-bold flex items-center gap-2 animate-fade-in">
          <ShieldCheck className="w-4 h-4 text-emerald-600" />
          <span>{lang === 'en' ? 'Work tags curated successfully!' : 'อัปเดตการจัดระเบียบแท็กประจำโครงการสำเร็จ!'}</span>
        </div>
      )}

      {/* Curation Form */}
      <form onSubmit={handleSave} className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 space-y-6">
        <h2 className="text-base font-bold text-slate-900 border-b border-slate-100 pb-3">
          {lang === 'en' ? 'Select Active Tags for this Work' : 'เลือกแท็กที่ต้องการผูกกับโครงการนี้'}
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {tags.map(tag => {
            const isSelected = selectedTagIds.includes(tag.id);
            return (
              <div
                key={tag.id}
                onClick={() => toggleTagSelection(tag.id)}
                className={`p-4 rounded-2xl border-2 cursor-pointer transition-all duration-150 flex items-center justify-between ${
                  isSelected
                    ? 'border-sky-500 bg-sky-50 text-slate-900'
                    : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'
                }`}
              >
                <div>
                  <span className="font-bold text-sm block">#{tag.name}</span>
                  <span className="text-[11px] opacity-75">Facet: {tag.facet}</span>
                </div>
                <div className={`w-6 h-6 rounded-lg flex items-center justify-center font-bold text-xs ${
                  isSelected ? 'bg-sky-600 text-white' : 'bg-slate-100 text-slate-400'
                }`}>
                  {isSelected ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex justify-end pt-4">
          <button
            type="submit"
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-bold text-sm transition-colors duration-150"
          >
            <Save className="w-4 h-4" />
            <span>{lang === 'en' ? 'Save Work Tag Overrides' : 'บันทึกการจัดระเบียบแท็ก'}</span>
          </button>
        </div>
      </form>
    </div>
  );
}
