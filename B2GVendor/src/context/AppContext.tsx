'use client';

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import {
  WorkItem,
  TagItem,
  NotificationItem,
  IngestionRun,
  GovSiteItem,
  MOCK_WORKS
} from '@/lib/mock-data';
import {
  fetchGovSites,
  fetchAdminGovSites,
  fetchTags,
  toGovSiteItem,
  toTagItem,
  fetchIngestionRuns,
  fetchPollStatus,
  pollSite,
  pollAllSites,
  toIngestionRun,
  updateGovSite,
  createGovSite,
  fetchSchedule,
  updateSchedule,
  BackendPollStatus,
  BackendScheduleOverview,
  CreateGovSiteBody
} from '@/lib/backend';

export type UserRole = 'visitor' | 'user' | 'admin' | 'superadmin';
export type AppLang = 'th' | 'en';
export type GovSitesStatus = 'loading' | 'ready' | 'error';

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
  // True while a poll is queued/running ANYWHERE -- decided by the server, so
  // it is the same for every admin account and survives a page refresh.
  isPolling: boolean;
  pollStatus: BackendPollStatus;
  pollError: string | null;
  clearPollError: () => void;
  triggerPollNow: (siteId?: string) => Promise<void>;
  retireTag: (tagId: string) => void;
  createTag: (name: string, facet: TagItem['facet']) => void;
  updateWorkTags: (workId: string, tagIds: string[]) => void;
  govSites: GovSiteItem[];
  govSitesStatus: GovSitesStatus;
  refreshGovSites: () => Promise<void>;
  // Sites with an enable/disable request in flight (each row's switch waits).
  togglingSiteIds: string[];
  // Both throw an ApiError on failure (e.g. 403 for a regular admin) so the
  // calling page can show the reason.
  toggleGovSiteEnabled: (siteId: string) => Promise<void>;
  addGovSite: (site: CreateGovSiteBody) => Promise<void>;
  schedule: BackendScheduleOverview | null;
  refreshSchedule: () => Promise<void>;
  saveSchedule: (patch: { pollIntervalMinutes?: number; scheduleEnabled?: boolean }) => Promise<void>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

// How often an open admin page re-asks the server whether a poll is running:
// quickly while one is (so the lock lifts as soon as it finishes), slowly
// otherwise (so a poll started by another admin, or by the scheduler, still
// shows up without a refresh).
const POLL_STATUS_ACTIVE_MS = 3000;
const POLL_STATUS_IDLE_MS = 10000;

// Admins get the enriched admin list (works count, last run, next run);
// everyone else the public directory. No mock fallback: an unreachable API is
// reported as an error rather than papered over with invented sites.
async function loadGovSites(asAdmin: boolean): Promise<GovSiteItem[]> {
  const list = asAdmin ? await fetchAdminGovSites() : await fetchGovSites();
  return list.map(toGovSiteItem);
}

interface GovSitesState {
  items: GovSiteItem[];
  // Which endpoint produced `items`: admins get the enriched list (last run,
  // next run, ...), everyone else the public directory.
  forAdmin: boolean;
  status: GovSitesStatus;
}

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
  const [pollStatus, setPollStatus] = useState<BackendPollStatus>({ isPolling: false, activeJobs: [] });
  // Between clicking "Poll Now" and the server confirming the job exists.
  const [pollStarting, setPollStarting] = useState<boolean>(false);
  const [pollError, setPollError] = useState<string | null>(null);
  const [govSitesState, setGovSitesState] = useState<GovSitesState>({ items: [], forAdmin: false, status: 'loading' });
  const [togglingSiteIds, setTogglingSiteIds] = useState<string[]>([]);
  const [schedule, setSchedule] = useState<BackendScheduleOverview | null>(null);
  const wasPollingRef = useRef<boolean>(false);

  const isAdminRole = role === 'admin' || role === 'superadmin';
  const isPolling = pollStatus.isPolling || pollStarting;
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

  // Government sites are always the REAL list from the backend (never a mock
  // fallback -- an unreachable API is reported as an error, not papered over
  // with invented data). Admins get the enriched admin list (works count, last
  // run, next run); everyone else the public directory. The tag taxonomy is
  // read the same way and drives every facet filter.
  const refreshGovSites = useCallback(async () => {
    try {
      const items = await loadGovSites(isAdminRole);
      setGovSitesState({ items, forAdmin: isAdminRole, status: 'ready' });
    } catch {
      // Keep whatever we already had on screen; just flag the failure.
      setGovSitesState(prev => ({ ...prev, status: 'error' }));
    }
  }, [isAdminRole]);

  // Initial load (and reload when the viewer becomes / stops being an admin).
  // Does its own fetch rather than calling refreshGovSites() so state is only
  // set from the promise callbacks, never synchronously inside the effect.
  useEffect(() => {
    let cancelled = false;

    loadGovSites(isAdminRole)
      .then(items => {
        if (!cancelled) setGovSitesState({ items, forAdmin: isAdminRole, status: 'ready' });
      })
      .catch(() => {
        if (!cancelled) setGovSitesState(prev => ({ ...prev, status: 'error' }));
      });

    return () => {
      cancelled = true;
    };
  }, [isAdminRole]);

  useEffect(() => {
    let cancelled = false;

    fetchTags()
      .then(list => {
        if (!cancelled) setTags(list.map(toTagItem));
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  // Until the list for the CURRENT kind of viewer has arrived (e.g. right
  // after an admin signs in, while the public list is still on screen), report
  // "loading" rather than showing admin columns full of blanks.
  const govSitesStatus: GovSitesStatus =
    govSitesState.status === 'ready' && govSitesState.forAdmin !== isAdminRole ? 'loading' : govSitesState.status;
  const govSites = govSitesState.items;

  const refreshSchedule = useCallback(async () => {
    try {
      setSchedule(await fetchSchedule());
    } catch {
      // Leave the last known schedule on screen.
    }
  }, []);

  useEffect(() => {
    if (!isAdminRole) return;
    let cancelled = false;

    fetchSchedule()
      .then(next => {
        if (!cancelled) setSchedule(next);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [isAdminRole]);

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

  const refreshIngestionRuns = useCallback(async (filters?: { siteId?: string }) => {
    const result = await fetchIngestionRuns({ siteId: filters?.siteId, pageSize: 50 });
    setIngestionRuns(result.items.map(toIngestionRun));
  }, []);

  // A poll just finished (for whoever started it): pull in what it produced.
  const refreshAfterPoll = useCallback(() => {
    refreshIngestionRuns().catch(() => {});
    refreshGovSites();
    refreshSchedule();
  }, [refreshIngestionRuns, refreshGovSites, refreshSchedule]);

  // "Poll Now" is a background job: the API only enqueues it and the worker
  // process runs it, so nothing here waits on it. Whether one is running is
  // asked of the SERVER (GET /admin/ingestion/status) -- never remembered in
  // this tab -- so the button stays locked for every admin account and after a
  // page refresh, until the job is really done.
  useEffect(() => {
    if (!isAdminRole) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      let delay = POLL_STATUS_IDLE_MS;
      try {
        const status = await fetchPollStatus();
        if (cancelled) return;
        setPollStatus(status);
        if (wasPollingRef.current && !status.isPolling) refreshAfterPoll();
        wasPollingRef.current = status.isPolling;
        if (status.isPolling) delay = POLL_STATUS_ACTIVE_MS;
      } catch {
        // Transient (network blip, API restarting) -- just try again shortly.
      }
      if (!cancelled) timer = setTimeout(tick, delay);
    };

    tick();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [isAdminRole, refreshAfterPoll]);

  const triggerPollNow = async (siteId?: string) => {
    if (isPolling) return;
    setPollError(null);
    setPollStarting(true);

    try {
      if (siteId) await pollSite(siteId, 'both');
      else await pollAllSites();
    } catch (err) {
      // 409 = someone else's poll is already running: not an error, the
      // status refresh below simply shows it (and keeps the button locked).
      if (!(err instanceof ApiError && err.code === 'CONFLICT')) {
        setPollError(err instanceof ApiError ? err.message : 'Could not start the poll. Please try again.');
      }
    }

    try {
      const status = await fetchPollStatus();
      setPollStatus(status);
      wasPollingRef.current = status.isPolling;
      // Already finished by the time we asked -- the status loop will never
      // see a "was running" -> "idle" change, so refresh now.
      if (!status.isPolling) refreshAfterPoll();
    } catch {
      // The status loop above corrects this on its next tick.
    }
    setPollStarting(false);
  };

  const clearPollError = () => setPollError(null);

  const addGovSite = async (site: CreateGovSiteBody) => {
    await createGovSite(site);
    await refreshGovSites();
    // Creating a site also creates its followable "site" tag on the backend.
    fetchTags()
      .then(list => setTags(list.map(toTagItem)))
      .catch(() => {});
  };

  // Persisted through the API (Super Admin only): a disabled department is
  // skipped by every scheduled poll and by "Poll Now -> all sites".
  const toggleGovSiteEnabled = async (siteId: string) => {
    const site = govSitesState.items.find(s => s.id === siteId);
    if (!site || togglingSiteIds.includes(siteId)) return;

    setTogglingSiteIds(prev => [...prev, siteId]);
    try {
      const updated = await updateGovSite(siteId, { enabled: !site.enabled });
      setGovSitesState(prev => ({
        ...prev,
        items: prev.items.map(s => (s.id === siteId ? { ...s, enabled: updated.enabled } : s))
      }));
      // Enabling/disabling changes the site's next scheduled run.
      refreshGovSites();
      refreshSchedule();
    } finally {
      setTogglingSiteIds(prev => prev.filter(id => id !== siteId));
    }
  };

  const saveSchedule = async (patch: { pollIntervalMinutes?: number; scheduleEnabled?: boolean }) => {
    setSchedule(await updateSchedule(patch));
    // Per-site "next run" times move with the interval.
    refreshGovSites();
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
        pollStatus,
        pollError,
        clearPollError,
        triggerPollNow,
        retireTag,
        createTag,
        updateWorkTags,
        govSites,
        govSitesStatus,
        refreshGovSites,
        togglingSiteIds,
        toggleGovSiteEnabled,
        addGovSite,
        schedule,
        refreshSchedule,
        saveSchedule
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
