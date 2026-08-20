'use client';

import React, { useState } from 'react';
import { useApp } from '@/context/AppContext';
import { Users, UserPlus, X } from 'lucide-react';

interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: string;
  department: string;
  lastActive: string;
}

const INITIAL_ADMIN_USERS: AdminUser[] = [
  { id: 'usr-1', name: 'ผู้ดูแลระบบ กทม.', email: 'admin@bma.go.th', role: 'Super Admin', department: 'สำนักดิจิทัลเพื่อการพัฒนาเมือง', lastActive: '2026-08-11 15:40' },
  { id: 'usr-2', name: 'เจ้าหน้าที่ไอที สนย.', email: 'yotha-staff@bma.go.th', role: 'Tag Curator', department: 'สำนักการโยธา', lastActive: '2026-08-10 11:20' },
  { id: 'usr-3', name: 'เจ้าหน้าที่ระบบการแพทย์', email: 'med-staff@bma.go.th', role: 'Ingestion Viewer', department: 'สำนักการแพทย์', lastActive: '2026-08-08 09:15' }
];

const ROLE_OPTIONS = ['Super Admin', 'Tag Curator', 'Ingestion Viewer'];

export default function AdminUsersPage() {
  const { lang } = useApp();

  const [adminUsers, setAdminUsers] = useState<AdminUser[]>(INITIAL_ADMIN_USERS);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState(ROLE_OPTIONS[1]);
  const [newDepartment, setNewDepartment] = useState('');

  const closeAddModal = () => {
    setShowAddModal(false);
    setNewName('');
    setNewEmail('');
    setNewRole(ROLE_OPTIONS[1]);
    setNewDepartment('');
  };

  const handleAddStaff = () => {
    if (!newName.trim() || !newEmail.trim() || !newDepartment.trim()) return;
    const now = new Date();
    const lastActive = `${now.toISOString().split('T')[0]} ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    setAdminUsers(prev => [
      { id: `usr-${Date.now()}`, name: newName.trim(), email: newEmail.trim(), role: newRole, department: newDepartment.trim(), lastActive },
      ...prev
    ]);
    closeAddModal();
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 flex items-center gap-2">
            <Users className="w-6 h-6 text-sky-600" />
            <span>{lang === 'en' ? 'Admin & Staff Management' : 'จัดการบัญชีเจ้าหน้าที่ผู้ดูแลระบบ (Admin Users)'}</span>
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            {lang === 'en' ? 'Manage admin roles, tag curation permissions, and staff accounts separate from public users' : 'แยกบัญชีเจ้าหน้าที่ผู้ปฏิบัติงานออกจากบัญชีผู้ค้าสาธารณะ'}
          </p>
        </div>

        <button
          onClick={() => setShowAddModal(true)}
          className="px-4 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-bold text-xs flex items-center gap-1.5 transition-colors duration-150"
        >
          <UserPlus className="w-4 h-4" />
          <span>{lang === 'en' ? 'Add Admin Staff' : 'เพิ่มเจ้าหน้าที่ใหม่'}</span>
        </button>
      </div>

      {/* Admin Users Table */}
      <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 font-bold uppercase border-b border-slate-200">
              <tr>
                <th className="p-4">{lang === 'en' ? 'Name & Email' : 'ชื่อเจ้าหน้าที่ & อีเมล'}</th>
                <th className="p-4">{lang === 'en' ? 'Role' : 'สิทธิ์ในระบบ'}</th>
                <th className="p-4">{lang === 'en' ? 'Department' : 'สังกัดหน่วยงาน'}</th>
                <th className="p-4">{lang === 'en' ? 'Last Active' : 'ใช้งานล่าสุด'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium">
              {adminUsers.map(user => (
                <tr key={user.id} className="hover:bg-slate-50 transition-colors">
                  <td className="p-4">
                    <p className="font-bold text-slate-900">{user.name}</p>
                    <p className="text-slate-400 text-[11px] font-mono">{user.email}</p>
                  </td>
                  <td className="p-4">
                    <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-sky-50 text-sky-700 border border-sky-100">
                      {user.role}
                    </span>
                  </td>
                  <td className="p-4 text-slate-600">{user.department}</td>
                  <td className="p-4 text-slate-400 font-mono">{user.lastActive}</td>
                </tr>
              ))}
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
                <span>{lang === 'en' ? 'Add Admin Staff' : 'เพิ่มเจ้าหน้าที่ใหม่'}</span>
              </h2>
              <button onClick={closeAddModal} className="text-slate-400 hover:text-slate-700 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase">
                  {lang === 'en' ? 'Name' : 'ชื่อ-นามสกุล'}
                </label>
                <input
                  type="text"
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="mt-1 w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-900 outline-hidden focus:border-sky-400"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-500 uppercase">
                  {lang === 'en' ? 'Email' : 'อีเมล'}
                </label>
                <input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="staff@bma.go.th"
                  className="mt-1 w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-900 outline-hidden focus:border-sky-400"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-500 uppercase">
                  {lang === 'en' ? 'Role' : 'สิทธิ์ในระบบ'}
                </label>
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value)}
                  className="mt-1 w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-900 outline-hidden focus:border-sky-400"
                >
                  {ROLE_OPTIONS.map(role => (
                    <option key={role} value={role}>{role}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-500 uppercase">
                  {lang === 'en' ? 'Department' : 'สังกัดหน่วยงาน'}
                </label>
                <input
                  type="text"
                  value={newDepartment}
                  onChange={(e) => setNewDepartment(e.target.value)}
                  className="mt-1 w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-900 outline-hidden focus:border-sky-400"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={closeAddModal}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-500 hover:bg-slate-50 transition-colors"
              >
                {lang === 'en' ? 'Cancel' : 'ยกเลิก'}
              </button>
              <button
                onClick={handleAddStaff}
                disabled={!newName.trim() || !newEmail.trim() || !newDepartment.trim()}
                className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-xs transition-colors"
              >
                {lang === 'en' ? 'Add Staff' : 'เพิ่มเจ้าหน้าที่'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
