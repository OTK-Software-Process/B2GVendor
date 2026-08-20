'use client';

import React, { useState } from 'react';
import { useApp } from '@/context/AppContext';
import { MOCK_VENDOR_ACCOUNTS, VendorAccount } from '@/lib/mock-data';
import { Users, Search, UserPlus, X, Ban, CheckCircle2, Trash2 } from 'lucide-react';

const emptyForm = { name: '', email: '', type: 'individual' as VendorAccount['type'], companyName: '', taxId: '' };

export default function VendorAccountsPage() {
  const { lang } = useApp();
  const [accounts, setAccounts] = useState<VendorAccount[]>(MOCK_VENDOR_ACCOUNTS);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'individual' | 'business'>('all');
  const [showAddModal, setShowAddModal] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const filtered = accounts.filter(a => {
    if (typeFilter !== 'all' && a.type !== typeFilter) return false;
    if (query) {
      const q = query.toLowerCase();
      if (!a.name.toLowerCase().includes(q) && !a.email.toLowerCase().includes(q) && !(a.companyName || '').toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const closeModal = () => {
    setShowAddModal(false);
    setForm(emptyForm);
  };

  const handleAdd = () => {
    if (!form.name.trim() || !form.email.trim()) return;
    const newAccount: VendorAccount = {
      id: `vnd-${Date.now()}`,
      name: form.name.trim(),
      email: form.email.trim(),
      type: form.type,
      companyName: form.type === 'business' ? form.companyName.trim() : undefined,
      taxId: form.type === 'business' ? form.taxId.trim() : undefined,
      followedTagsCount: 0,
      status: 'active',
      registeredDate: new Date().toISOString().split('T')[0]
    };
    setAccounts(prev => [newAccount, ...prev]);
    closeModal();
  };

  const toggleStatus = (id: string) => {
    setAccounts(prev => prev.map(a => a.id === id ? { ...a, status: a.status === 'active' ? 'suspended' : 'active' } : a));
  };

  const removeAccount = (id: string, name: string) => {
    if (confirm(lang === 'en' ? `Delete account "${name}"? This cannot be undone.` : `ลบบัญชี "${name}"? ไม่สามารถกู้คืนได้`)) {
      setAccounts(prev => prev.filter(a => a.id !== id));
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 flex items-center gap-2">
            <Users className="w-6 h-6 text-sky-600" />
            <span>{lang === 'en' ? 'Vendor Accounts' : 'บัญชีผู้ค้า'}</span>
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            {lang === 'en' ? 'Unified accounts — individual and business — search, add, suspend, or remove' : 'บัญชีผู้ใช้งานแบบรวมศูนย์ ทั้งบุคคลและนิติบุคคล ค้นหา เพิ่ม ระงับ หรือลบได้'}
          </p>
        </div>

        <button
          onClick={() => setShowAddModal(true)}
          className="px-4 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-bold text-xs flex items-center gap-1.5 transition-colors duration-150"
        >
          <UserPlus className="w-4 h-4" />
          <span>{lang === 'en' ? 'Add Account' : 'เพิ่มบัญชี'}</span>
        </button>
      </div>

      {/* Search + Filter */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex items-center bg-white border border-slate-200 rounded-2xl px-4 py-2.5 flex-1 min-w-[240px] focus-within:border-sky-400 transition-colors">
          <Search className="w-4 h-4 text-slate-400 mr-3" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={lang === 'en' ? 'Search name, email, or company...' : 'ค้นหาชื่อ อีเมล หรือชื่อบริษัท...'}
            className="w-full bg-transparent outline-hidden text-sm text-slate-900"
          />
        </div>

        <div className="inline-flex items-center gap-0.5 p-0.5 rounded-xl border border-slate-200 bg-white">
          {(['all', 'individual', 'business'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 ${
                typeFilter === t ? 'bg-sky-600 text-white' : 'text-slate-500 hover:text-sky-700'
              }`}
            >
              {t === 'all' ? (lang === 'en' ? 'All' : 'ทั้งหมด') : t === 'individual' ? (lang === 'en' ? 'Individual' : 'บุคคล') : (lang === 'en' ? 'Business' : 'นิติบุคคล')}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 font-bold uppercase border-b border-slate-200">
              <tr>
                <th className="p-4">{lang === 'en' ? 'Name & Email' : 'ชื่อ & อีเมล'}</th>
                <th className="p-4">{lang === 'en' ? 'Type' : 'ประเภทบัญชี'}</th>
                <th className="p-4">{lang === 'en' ? 'Followed Tags' : 'แท็กที่ติดตาม'}</th>
                <th className="p-4">{lang === 'en' ? 'Registered' : 'วันที่ลงทะเบียน'}</th>
                <th className="p-4">{lang === 'en' ? 'Status' : 'สถานะ'}</th>
                <th className="p-4 text-right">{lang === 'en' ? 'Actions' : 'จัดการ'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium">
              {filtered.map(account => (
                <tr key={account.id} className="hover:bg-slate-50 transition-colors">
                  <td className="p-4">
                    <p className="font-bold text-slate-900">{account.name}</p>
                    <p className="text-slate-400 text-[11px] font-mono">{account.email}</p>
                    {account.companyName && <p className="text-slate-500 text-[11px] mt-0.5">{account.companyName}</p>}
                  </td>
                  <td className="p-4">
                    <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${
                      account.type === 'business' ? 'bg-sky-50 text-sky-700 border-sky-100' : 'bg-slate-100 text-slate-600 border-slate-200'
                    }`}>
                      {account.type === 'business' ? (lang === 'en' ? 'Business' : 'นิติบุคคล') : (lang === 'en' ? 'Individual' : 'บุคคล')}
                    </span>
                  </td>
                  <td className="p-4 text-slate-600">{account.followedTagsCount}</td>
                  <td className="p-4 text-slate-400 font-mono">{account.registeredDate}</td>
                  <td className="p-4">
                    <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${
                      account.status === 'active' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-rose-50 text-rose-700 border-rose-100'
                    }`}>
                      {account.status === 'active' ? (lang === 'en' ? 'Active' : 'ใช้งานอยู่') : (lang === 'en' ? 'Suspended' : 'ถูกระงับ')}
                    </span>
                  </td>
                  <td className="p-4">
                    <div className="flex items-center justify-end gap-3">
                      <button
                        onClick={() => toggleStatus(account.id)}
                        className={`inline-flex items-center gap-1 font-semibold transition-colors ${
                          account.status === 'active' ? 'text-amber-600 hover:text-amber-700' : 'text-emerald-600 hover:text-emerald-700'
                        }`}
                      >
                        {account.status === 'active' ? <Ban className="w-3.5 h-3.5" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                        <span>{account.status === 'active' ? (lang === 'en' ? 'Suspend' : 'ระงับ') : (lang === 'en' ? 'Activate' : 'เปิดใช้')}</span>
                      </button>
                      <button
                        onClick={() => removeAccount(account.id, account.name)}
                        className="inline-flex items-center gap-1 text-rose-600 hover:text-rose-700 font-semibold transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>{lang === 'en' ? 'Delete' : 'ลบ'}</span>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-slate-400">
                    {lang === 'en' ? 'No accounts match your search.' : 'ไม่พบบัญชีที่ตรงกับการค้นหา'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 animate-fade-in">
          <div className="bg-white border border-slate-200 rounded-3xl p-6 w-full max-w-md space-y-5 animate-scale-in">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-extrabold text-slate-900 flex items-center gap-2">
                <UserPlus className="w-5 h-5 text-sky-600" />
                <span>{lang === 'en' ? 'Add Vendor Account' : 'เพิ่มบัญชีผู้ค้า'}</span>
              </h2>
              <button onClick={closeModal} className="text-slate-400 hover:text-slate-700 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase">{lang === 'en' ? 'Name' : 'ชื่อ-นามสกุล'}</label>
                <input
                  type="text"
                  autoFocus
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="mt-1 w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-900 outline-hidden focus:border-sky-400"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-500 uppercase">{lang === 'en' ? 'Email' : 'อีเมล'}</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="mt-1 w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-900 outline-hidden focus:border-sky-400"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-500 uppercase">{lang === 'en' ? 'Account Type' : 'ประเภทบัญชี'}</label>
                <select
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value as VendorAccount['type'] })}
                  className="mt-1 w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-900 outline-hidden focus:border-sky-400"
                >
                  <option value="individual">{lang === 'en' ? 'Individual' : 'บุคคล'}</option>
                  <option value="business">{lang === 'en' ? 'Business' : 'นิติบุคคล'}</option>
                </select>
              </div>

              {form.type === 'business' && (
                <div className="space-y-3 animate-fade-in">
                  <div>
                    <label className="text-xs font-bold text-slate-500 uppercase">{lang === 'en' ? 'Company Name' : 'ชื่อบริษัท'}</label>
                    <input
                      type="text"
                      value={form.companyName}
                      onChange={(e) => setForm({ ...form, companyName: e.target.value })}
                      className="mt-1 w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-900 outline-hidden focus:border-sky-400"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-500 uppercase">{lang === 'en' ? 'Tax ID' : 'เลขประจำตัวผู้เสียภาษี'}</label>
                    <input
                      type="text"
                      value={form.taxId}
                      onChange={(e) => setForm({ ...form, taxId: e.target.value })}
                      className="mt-1 w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-mono text-slate-900 outline-hidden focus:border-sky-400"
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button onClick={closeModal} className="px-4 py-2 rounded-xl text-xs font-bold text-slate-500 hover:bg-slate-50 transition-colors">
                {lang === 'en' ? 'Cancel' : 'ยกเลิก'}
              </button>
              <button
                onClick={handleAdd}
                disabled={!form.name.trim() || !form.email.trim()}
                className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-xs transition-colors"
              >
                {lang === 'en' ? 'Add Account' : 'เพิ่มบัญชี'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
