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
  MOCK_GOV_SITES
} from '@/lib/mock-data';
import {
  fetchGovSites,
  fetchTags,
  toGovSiteItem,
  toTagItem,
  fetchIngestionRuns,
  fetchPollJob,
  pollSite,
  pollAllSites,
  toIngestionRun,
  BackendPollJobStatus
} from '@/lib/backend';

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

interface ApiTag extends Omit<TagItem, 'id' | 'followerCount' | 'worksCount'> {
  _id: string;
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
  toggleFollowTag: (tagId: string) => Promise<void>;
  isTagFollowed: (tagId: string) => boolean;
  notifications: NotificationItem[];
  unreadCount: number;
  markNotificationAsRead: (id: string) => Promise<void>;
  markAllNotificationsAsRead: () => Promise<void>;
  works: WorkItem[];
  tags: TagItem[];
  ingestionRuns: IngestionRun[];
  refreshIngestionRuns: (filters?: { siteId?: string }) => Promise<void>;
  isPolling: boolean;
  triggerPollNow: (siteId?: string) => Promise<void>;
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
  const [followedTagIds, setFollowedTagIds] = useState<string[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [works, setWorks] = useState<WorkItem[]>(MOCK_WORKS);
  const [tags, setTags] = useState<TagItem[]>([]);
  const [ingestionRuns, setIngestionRuns] = useState<IngestionRun[]>([]);
  const [isPolling, setIsPolling] = useState<boolean>(false);
  const [govSites, setGovSites] = useState<GovSiteItem[]>(MOCK_GOV_SITES);

  const unreadCount = notifications.filter(n => !n.read).length;

  const signIn = (nextAccount: AccountView) => {
    setAccount(nextAccount);
    setRole(nextAccount.role);

    // The initial-mount effect below only fetches follows/notifications when
    // a session cookie ALREADY exists at mount time (e.g. a page refresh
    // while logged in) -- a fresh login/register call here directly instead,
    // so notifications are visible immediately rather than only after the
    // next full page reload.
    Promise.all([api.get<ApiTag[]>('/follows/tags'), api.get<NotificationItem[]>('/notifications')])
      .then(([apiTags, apiNotifications]) => {
        setFollowedTagIds(apiTags.map(tag => tag._id));
        setNotifications(apiNotifications);
      })
      .catch(() => {
        // Best-effort -- signIn itself already succeeded, don't block on this.
      });
  };

  // On load, check for a real session cookie from the backend. If nobody is
  // logged in, /auth/me 401s and the default 'visitor' role stands. If a
  // real session cookie exists (e.g. after login/register, then a page
  // refresh), the app reflects the real account instead.
  useEffect(() => {
    let cancelled = false;

    api
      .get<AccountView>('/auth/me')
      .then(me => {
        if (cancelled) return [[], []] as [ApiTag[], NotificationItem[]];
        signIn(me);
        return Promise.all([
          api.get<ApiTag[]>('/follows/tags'),
          api.get<NotificationItem[]>('/notifications')
        ]);
      })
      .then(([apiTags, apiNotifications]) => {
        if (!cancelled) {
          setFollowedTagIds(apiTags.map(tag => tag._id));
          setNotifications(apiNotifications);
        }
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
  }, []);

  // Government sites and the tag taxonomy are read from the real backend
  // (public GET /gov-sites, GET /tags) -- they drive the site directory and
  // every facet filter on the search/agencies pages. If the API isn't
  // reachable (e.g. local dev without the backend running), fall back to
  // the mock directory rather than leaving the UI empty.
  useEffect(() => {
    let cancelled = false;

    fetchGovSites()
      .then(sites => {
        if (!cancelled) setGovSites(sites.map(toGovSiteItem));
      })
      .catch(() => {});

    fetchTags()
      .then(list => {
        if (!cancelled) setTags(list.map(toTagItem));
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

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

  const toggleFollowTag = async (tagId: string) => {
    const isFollowed = followedTagIds.includes(tagId);
    if (isFollowed) {
      await api.del(`/follows/tags/${tagId}`);
      setFollowedTagIds(prev => prev.filter(id => id !== tagId));
      return;
    }

    await api.post(`/follows/tags/${tagId}`);
    setFollowedTagIds(prev => (prev.includes(tagId) ? prev : [...prev, tagId]));
  };

  const isTagFollowed = (tagId: string) => followedTagIds.includes(tagId);

  const markNotificationAsRead = async (id: string) => {
    await api.patch(`/notifications/${id}/read`);
    setNotifications(prev => prev.map(n => (n.id === id ? { ...n, read: true } : n)));
  };

  const markAllNotificationsAsRead = async () => {
    await api.post('/notifications/read-all');
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  };

  const refreshIngestionRuns = async (filters?: { siteId?: string }) => {
    const result = await fetchIngestionRuns({ siteId: filters?.siteId, pageSize: 50 });
    setIngestionRuns(result.items.map(toIngestionRun));
  };

  // The API call only enqueues a PollJob and returns immediately (status
  // "queued") -- the actual work happens in the separate ingestion-worker
  // process (Backend/src/worker.ts), which claims it on its own schedule
  // (POLL_JOB_CLAIM_INTERVAL_MS, default 5s). Poll the job's own status
  // until it's done/failed so the UI's "Poll Now" lock reflects when the
  // real ingestion actually finishes, not just when it was queued. Bounded
  // to 10 minutes -- a real multi-site poll with AI tagging can genuinely
  // take several minutes; if it's still running past that, stop waiting
  // (the run itself keeps going server-side either way) rather than lock
  // the button forever on a slow/stuck job.
  const waitForPollJob = async (jobId: string): Promise<void> => {
    const deadline = Date.now() + 10 * 60 * 1000;
    while (Date.now() < deadline) {
      const job = await fetchPollJob(jobId);
      const terminal: BackendPollJobStatus[] = ['done', 'failed'];
      if (terminal.includes(job.status)) return;
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  };

  const triggerPollNow = async (siteId?: string) => {
    if (isPolling) return;
    setIsPolling(true);
    try {
      const job = siteId ? await pollSite(siteId, 'both') : await pollAllSites();
      await waitForPollJob(job._id);
    } catch {
      // Best-effort -- still refresh + unlock below even if enqueueing or
      // status polling itself failed (e.g. a network blip), so the button
      // never stays stuck locked.
    } finally {
      await refreshIngestionRuns(siteId ? { siteId } : undefined).catch(() => {});
      setIsPolling(false);
    }
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
        refreshIngestionRuns,
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
