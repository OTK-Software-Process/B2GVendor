'use client';

import React from 'react';
import { useApp } from '@/context/AppContext';
import { Bookmark, BookmarkCheck } from 'lucide-react';

interface FollowTagButtonProps {
  tagId: string;
  tagName: string;
  variant?: 'badge' | 'button' | 'icon';
  size?: 'sm' | 'md';
}

export function FollowTagButton({ tagId, tagName, variant = 'badge', size = 'sm' }: FollowTagButtonProps) {
  const { role, isTagFollowed, toggleFollowTag, lang } = useApp();
  const followed = isTagFollowed(tagId);

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (role === 'visitor') {
      alert(lang === 'en' ? 'Please log in or switch to Registered User mode to follow tags!' : 'กรุณาเข้าสู่ระบบหรือเปลี่ยนเป็นโหมดผู้ใช้งานเพื่อติดตามแท็ก');
      return;
    }
    toggleFollowTag(tagId);
  };

  if (variant === 'icon') {
    return (
      <button
        onClick={handleClick}
        title={followed ? (lang === 'en' ? `Unfollow ${tagName}` : `เลิกติดตาม ${tagName}`) : (lang === 'en' ? `Follow ${tagName}` : `ติดตาม ${tagName}`)}
        className={`p-1.5 rounded-lg transition-colors duration-150 ${
          followed
            ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
        }`}
      >
        {followed ? <BookmarkCheck className="w-4 h-4" /> : <Bookmark className="w-4 h-4" />}
      </button>
    );
  }

  if (variant === 'button') {
    return (
      <button
        onClick={handleClick}
        className={`inline-flex items-center gap-1.5 font-medium rounded-lg transition-all duration-150 ${
          size === 'sm' ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm'
        } ${
          followed
            ? 'bg-emerald-600 text-white hover:bg-emerald-700'
            : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200'
        }`}
      >
        {followed ? <BookmarkCheck className="w-3.5 h-3.5" /> : <Bookmark className="w-3.5 h-3.5" />}
        <span>
          {followed
            ? (lang === 'en' ? 'Following' : 'ติดตามแล้ว')
            : (lang === 'en' ? 'Follow Tag' : 'ติดตามแท็กนี้')}
        </span>
      </button>
    );
  }

  return (
    <button
      onClick={handleClick}
      className={`font-medium rounded-full transition-all duration-150 ${
        size === 'sm' ? 'px-2.5 py-0.5 text-xs' : 'px-3 py-1 text-sm'
      } ${
        followed
          ? 'bg-emerald-500 text-white'
          : 'bg-slate-100 text-slate-700 hover:bg-emerald-50 hover:text-emerald-700 border border-slate-200'
      }`}
    >
      {tagName}
    </button>
  );
}
