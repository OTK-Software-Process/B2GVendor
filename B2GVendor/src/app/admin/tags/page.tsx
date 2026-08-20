'use client';

import React, { useState } from 'react';
import { useApp } from '@/context/AppContext';
import { Tags, Plus, Search, Trash2, X, Info } from 'lucide-react';

export default function AdminTagsPage() {
  const { lang, tags, retireTag, createTag } = useApp();
  const [searchQuery, setSearchQuery] = useState('');
  const [newTagName, setNewTagName] = useState('');
  const [newFacet, setNewFacet] = useState<'category' | 'agency' | 'method' | 'keyword'>('category');
  const [showCreateModal, setShowCreateModal] = useState(false);

  const filteredTags = tags.filter(t =>
    t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    t.aliases.some(a => a.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const closeCreateModal = () => {
    setShowCreateModal(false);
    setNewTagName('');
    setNewFacet('category');
  };

  const handleCreateTag = () => {
    const name = newTagName.trim();
    if (!name) return;
    createTag(name, newFacet);
    closeCreateModal();
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 flex items-center gap-2">
            <Tags className="w-6 h-6 text-sky-600" />
            <span>{lang === 'en' ? 'Tag Vocabulary & Alias Management' : 'การจัดการคลังแท็กและชื่อพ้อง'}</span>
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            {lang === 'en' ? 'Create canonical tags, define aliases, and retire tags that are no longer needed' : 'สร้างแท็กหลัก กำหนดคำพ้อง (Aliases) และปลดระวางแท็กที่ไม่ใช้งานแล้ว'}
          </p>
        </div>

        <button
          onClick={() => setShowCreateModal(true)}
          className="px-4 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-bold text-xs flex items-center gap-1.5 transition-colors duration-150"
        >
          <Plus className="w-4 h-4" />
          <span>{lang === 'en' ? 'Create New Tag' : 'สร้างแท็กใหม่'}</span>
        </button>
      </div>

      {/* How tagging works */}
      <div className="flex items-start gap-2.5 text-xs text-slate-600 bg-sky-50 border border-sky-100 rounded-2xl p-4">
        <Info className="w-4 h-4 text-sky-600 shrink-0 mt-0.5" />
        <p className="leading-relaxed">
          {lang === 'en' ? (
            <>New work is tagged <strong>automatically</strong> on every poll — the system matches its government site, agency, method, and category text against this vocabulary (including aliases below), no manual tagging needed for the common case. <strong>Government site tags</strong> (BMA, EGAT, PEA, etc.) are created automatically whenever a super admin adds a site in Source Configuration — they don&apos;t need to be created here. Admins can still override a specific work&apos;s tags anytime from its detail page. <strong>Adding a tag here applies to future polls immediately</strong> — it does not retroactively re-tag work already in the system unless you re-tag it manually.</>
          ) : (
            <>งานใหม่จะถูก<strong>ติดแท็กอัตโนมัติ</strong>ทุกครั้งที่ดึงข้อมูล โดยจับคู่หน่วยงานภาครัฐ หน่วยงานย่อย วิธีจัดซื้อ และหมวดหมู่ กับคลังคำศัพท์นี้ (รวมคำพ้องความหมายด้านล่าง) ไม่ต้องติดแท็กด้วยมือในกรณีทั่วไป <strong>แท็กหน่วยงานภาครัฐ</strong> (BMA, EGAT, PEA ฯลฯ) จะถูกสร้างขึ้นอัตโนมัติทุกครั้งที่ผู้ดูแลระบบสูงสุดเพิ่มหน่วยงานใหม่ในหน้าการตั้งค่าแหล่งข้อมูล ไม่ต้องสร้างที่นี่ ผู้ดูแลยังสามารถแก้ไขแท็กของงานแต่ละรายการได้จากหน้ารายละเอียดงาน <strong>การเพิ่มแท็กใหม่ที่นี่จะมีผลกับการดึงข้อมูลรอบถัดไปทันที</strong> แต่จะไม่ย้อนไปติดแท็กงานเก่าที่มีอยู่แล้ว เว้นแต่จะแก้ไขด้วยมือ</>
          )}
        </p>
      </div>

      {/* Search Bar */}
      <div className="relative flex items-center bg-white border border-slate-200 rounded-2xl px-4 py-2.5 focus-within:border-sky-400 transition-colors">
        <Search className="w-4 h-4 text-slate-400 mr-3" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={lang === 'en' ? 'Search tag name or aliases...' : 'ค้นหาแท็กหรือคำพ้องความหมาย (Aliases)...'}
          className="w-full bg-transparent outline-hidden text-sm text-slate-900"
        />
      </div>

      {/* Tag Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filteredTags.map(tag => (
          <div key={tag.id} className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3 flex flex-col justify-between transition-colors duration-150 hover:border-sky-300">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono font-bold uppercase text-sky-700 bg-sky-50 px-2 py-0.5 rounded-md border border-sky-100">
                  {tag.facet}
                </span>
                <span className="text-xs text-slate-500 font-medium">
                  {tag.followerCount} ผู้ติดตาม • {tag.worksCount} โครงการ
                </span>
              </div>

              <h3 className="font-extrabold text-base text-slate-900">#{tag.name}</h3>

              <div className="text-xs text-slate-500 bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                <span className="font-semibold text-slate-600">Aliases: </span>
                <span>{tag.aliases.length > 0 ? tag.aliases.join(', ') : 'ไม่มี'}</span>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100 flex items-center justify-end text-xs font-semibold">
              <button
                onClick={() => {
                  if (confirm(`ยืนยันการปลดระวางแท็ก #${tag.name}?`)) {
                    retireTag(tag.id);
                  }
                }}
                className="text-rose-600 hover:text-rose-700 flex items-center gap-1 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{lang === 'en' ? 'Retire Tag' : 'ปลดระวาง'}</span>
              </button>
            </div>
          </div>
        ))}
      </div>

      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 animate-fade-in">
          <div className="bg-white border border-slate-200 rounded-3xl p-6 w-full max-w-md space-y-5 animate-scale-in">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-extrabold text-slate-900 flex items-center gap-2">
                <Plus className="w-5 h-5 text-sky-600" />
                <span>{lang === 'en' ? 'Create New Tag' : 'สร้างแท็กใหม่'}</span>
              </h2>
              <button onClick={closeCreateModal} className="text-slate-400 hover:text-slate-700 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase">
                  {lang === 'en' ? 'Tag Name' : 'ชื่อแท็ก'}
                </label>
                <input
                  type="text"
                  autoFocus
                  value={newTagName}
                  onChange={(e) => setNewTagName(e.target.value)}
                  placeholder={lang === 'en' ? 'e.g. งานก่อสร้าง' : 'เช่น งานก่อสร้าง'}
                  className="mt-1 w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-900 outline-hidden focus:border-sky-400"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-500 uppercase">
                  {lang === 'en' ? 'Facet' : 'กลุ่มแท็ก (Facet)'}
                </label>
                <select
                  value={newFacet}
                  onChange={(e) => setNewFacet(e.target.value as 'category' | 'agency' | 'method' | 'keyword')}
                  className="mt-1 w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-900 outline-hidden focus:border-sky-400"
                >
                  <option value="category">{lang === 'en' ? 'Category' : 'หมวดหมู่งาน (Category)'}</option>
                  <option value="agency">{lang === 'en' ? 'Agency' : 'หน่วยงาน (Agency)'}</option>
                  <option value="method">{lang === 'en' ? 'Method' : 'วิธีจัดซื้อจัดจ้าง (Method)'}</option>
                  <option value="keyword">{lang === 'en' ? 'Keyword' : 'คำสำคัญ (Keyword)'}</option>
                </select>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={closeCreateModal}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-500 hover:bg-slate-50 transition-colors"
              >
                {lang === 'en' ? 'Cancel' : 'ยกเลิก'}
              </button>
              <button
                onClick={handleCreateTag}
                disabled={!newTagName.trim()}
                className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-xs transition-colors"
              >
                {lang === 'en' ? 'Create Tag' : 'สร้างแท็ก'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
