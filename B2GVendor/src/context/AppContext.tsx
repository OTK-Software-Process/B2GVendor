'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import {
  WorkItem,
  TagItem,
  NotificationItem,
  IngestionRun,
  GovSiteItem,
  MOCK_WORKS,
  MOCK_TAGS,
  MOCK_NOTIFICATIONS,
  MOCK_INGESTION_RUNS,
  MOCK_GOV_SITES
} from '@/lib/mock-data';

export type UserRole = 'visitor' | 'user' | 'admin' | 'superadmin';
export type AppLang = 'th' | 'en';

export interface AccountBusinessProfile {
  companyName: string;
  taxId: string;
}

export interface AccountView {
  id: string;
  name: string;
  email: string;
  phone?: string;
  type: 'individual' | 'business';
  businessProfile?: AccountBusinessProfile;
  status: 'active' | 'suspended';
  role: 'user' | 'admin' | 'superadmin';
}

interface AppContextType {
  role: UserRole;
  setRole: (role: UserRole) => void;
  authChecked: boolean;
  account: AccountView | null;
  signIn: (account: AccountView) => void;
  signOut: () => Promise<void>;
  lang: AppLang;
  setLang: (lang: AppLang) => void;
  followedTagIds: string[];
  toggleFollowTag: (tagId: string) => void;
  isTagFollowed: (tagId: string) => boolean;
  notifications: NotificationItem[];
  unreadCount: number;
  markNotificationAsRead: (id: string) => void;
  markAllNotificationsAsRead: () => void;
  works: WorkItem[];
  tags: TagItem[];
  ingestionRuns: IngestionRun[];
  isPolling: boolean;
  triggerPollNow: (siteId?: string) => void;
  retireTag: (tagId: string) => void;
  createTag: (name: string, facet: TagItem['facet']) => void;
  updateWorkTags: (workId: string, tagIds: string[]) => void;
  govSites: GovSiteItem[];
  addGovSite: (site: { name: string; nameEn: string; shortCode: string; datasetId: string; requestsPerMin: number }) => void;
  toggleGovSiteEnabled: (siteId: string) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [role, setRole] = useState<UserRole>('visitor');
  const [account, setAccount] = useState<AccountView | null>(null);
  const [authChecked, setAuthChecked] = useState<boolean>(false);
  const [lang, setLang] = useState<AppLang>('th');
  const [followedTagIds, setFollowedTagIds] = useState<string[]>(['tag-1', 'tag-4', 'tag-8']);
  const [notifications, setNotifications] = useState<NotificationItem[]>(MOCK_NOTIFICATIONS);
  const [works, setWorks] = useState<WorkItem[]>(MOCK_WORKS);
  const [tags, setTags] = useState<TagItem[]>(MOCK_TAGS);
  const [ingestionRuns, setIngestionRuns] = useState<IngestionRun[]>(MOCK_INGESTION_RUNS);
  const [isPolling, setIsPolling] = useState<boolean>(false);
  const [govSites, setGovSites] = useState<GovSiteItem[]>(MOCK_GOV_SITES);

  const unreadCount = notifications.filter(n => !n.read).length;

  // On load, check for a real session cookie from the backend. If nobody is
  // logged in, /auth/me 401s and the default 'visitor' role stands. If a
  // real session cookie exists (e.g. after login/register, then a page
  // refresh), the app reflects the real account instead.
  useEffect(() => {
    let cancelled = false;

    api
      .get<AccountView>('/auth/me')
      .then(me => {
        if (!cancelled) signIn(me);
      })
      .catch(() => {
        // Not logged in. Stay in the default 'visitor' state.
      })
      .finally(() => {
        if (!cancelled) setAuthChecked(true);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signIn = (nextAccount: AccountView) => {
    setAccount(nextAccount);
    setRole(nextAccount.role);
  };

  const signOut = async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      // Best-effort: even if the network call fails, clear local state so the
      // UI does not claim to be logged in.
    }
    setAccount(null);
    setRole('visitor');
  };

  const toggleFollowTag = (tagId: string) => {
    setFollowedTagIds(prev =>
      prev.includes(tagId) ? prev.filter(id => id !== tagId) : [...prev, tagId]
    );
  };

  const isTagFollowed = (tagId: string) => followedTagIds.includes(tagId);

  const markNotificationAsRead = (id: string) => {
    setNotifications(prev =>
      prev.map(n => (n.id === id ? { ...n, read: true } : n))
    );
  };

  const markAllNotificationsAsRead = () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  };

  const triggerPollNow = (siteId?: string) => {
    if (isPolling) return;
    setIsPolling(true);
    setTimeout(() => {
      const now = new Date();
      const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
      const targetSites = siteId ? govSites.filter(s => s.id === siteId) : govSites.filter(s => s.enabled);
      const siteBreakdown = targetSites.map(site => {
        const fetchedCount = 8 + Math.floor(Math.random() * 20);
        const newCount = Math.floor(Math.random() * 2);
        const updatedCount = Math.floor(Math.random() * 3);
        return { siteId: site.id, siteName: site.name, fetchedCount, newCount, updatedCount, failedCount: 0 };
      });
      const newRun: IngestionRun = {
        runId: `RUN-${now.getFullYear()}${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}-${now.getHours().toString().padStart(2, '0')}${now.getMinutes().toString().padStart(2, '0')}`,
        startTime: `${now.toISOString().split('T')[0]} ${timeStr}`,
        endTime: `${now.toISOString().split('T')[0]} ${timeStr}`,
        duration: '42s',
        status: 'SUCCESS',
        fetchedCount: siteBreakdown.reduce((sum, s) => sum + s.fetchedCount, 0),
        newCount: siteBreakdown.reduce((sum, s) => sum + s.newCount, 0),
        updatedCount: siteBreakdown.reduce((sum, s) => sum + s.updatedCount, 0),
        skippedCount: siteBreakdown.reduce((sum, s) => sum + s.fetchedCount - s.newCount - s.updatedCount, 0),
        failedCount: 0,
        siteBreakdown,
        logs: [
          { time: timeStr, level: 'INFO', message: siteId ? `การทริกเกอร์ Poll Now ด้วยมือเริ่มต้นโดยผู้ดูแลระบบ (เฉพาะ ${targetSites[0]?.name ?? siteId})` : 'การทริกเกอร์ Poll Now ด้วยมือเริ่มต้นโดยผู้ดูแลระบบ (ทุกหน่วยงานที่เปิดใช้งาน)' },
          { time: timeStr, level: 'INFO', message: `เรียก api.data.go.th สำเร็จสำหรับ ${targetSites.length} หน่วยงาน ดึงรายการทั้งหมด ${siteBreakdown.reduce((sum, s) => sum + s.fetchedCount, 0)} รายการ` },
          { time: timeStr, level: 'INFO', message: 'อัปเดตดัชนีการค้นหาและแท็กของระบบ B2G Vendor สำเร็จ' }
        ]
      };
      setIngestionRuns(prev => [newRun, ...prev]);
      setIsPolling(false);
    }, 2000);
  };

  const addGovSite = (site: { name: string; nameEn: string; shortCode: string; datasetId: string; requestsPerMin: number }) => {
    const newSite: GovSiteItem = {
      id: `site-${Date.now()}`,
      name: site.name,
      nameEn: site.nameEn,
      shortCode: site.shortCode,
      datasetId: site.datasetId,
      enabled: true,
      requestsPerMin: site.requestsPerMin,
      worksCount: 0
    };
    setGovSites(prev => [...prev, newSite]);
    setTags(prev => [
      { id: `tag-site-${newSite.id}`, name: `${site.name} (${site.shortCode})`, facet: 'site', aliases: [site.shortCode, site.nameEn], followerCount: 0, worksCount: 0 },
      ...prev
    ]);
  };

  const toggleGovSiteEnabled = (siteId: string) => {
    setGovSites(prev => prev.map(s => (s.id === siteId ? { ...s, enabled: !s.enabled } : s)));
  };

  const retireTag = (tagId: string) => {
    setTags(prev => prev.map(t => (t.id === tagId ? { ...t, retired: true } : t)));
  };

  const createTag = (name: string, facet: TagItem['facet']) => {
    const newTag: TagItem = {
      id: `tag-${Date.now()}`,
      name,
      facet,
      aliases: [],
      followerCount: 0,
      worksCount: 0
    };
    setTags(prev => [newTag, ...prev]);
  };

  const updateWorkTags = (workId: string, tagIds: string[]) => {
    const newTags = tags.filter(t => tagIds.includes(t.id));
    setWorks(prev =>
      prev.map(w => (w.id === workId ? { ...w, tags: newTags } : w))
    );
  };

  return (
    <AppContext.Provider
      value={{
        role,
        setRole,
        authChecked,
        account,
        signIn,
        signOut,
        lang,
        setLang,
        followedTagIds,
        toggleFollowTag,
        isTagFollowed,
        notifications,
        unreadCount,
        markNotificationAsRead,
        markAllNotificationsAsRead,
        works,
        tags,
        ingestionRuns,
        isPolling,
        triggerPollNow,
        retireTag,
        createTag,
        updateWorkTags,
        govSites,
        addGovSite,
        toggleGovSiteEnabled
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
}
