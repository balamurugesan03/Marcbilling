import { create } from 'zustand';
import axios from 'axios';
import { bindAuth, refreshSession } from '../lib/api';

const BRANCH_KEY = 'fpos-branch';
const readBranch = () => { try { return localStorage.getItem(BRANCH_KEY); } catch { return null; } };

export const useAuth = create((set, get) => ({
  ready: false,
  accessToken: null,
  user: null,
  company: null,
  branches: [],
  branchId: null, // selected branch id or 'all'
  settings: null,

  can: (...perms) => {
    const p = get().user?.role?.permissions || [];
    return perms.some((k) => p.includes(k));
  },
  allBranchesAllowed: () => Boolean(get().user?.role?.allBranches),
  currentBranch: () => get().branches.find((b) => b._id === get().branchId) || null,

  applySession(data) {
    const saved = readBranch();
    const { branches, user } = data;
    let branchId = get().branchId || saved;
    const valid = branchId === 'all' ? user.role.allBranches : branches.some((b) => b._id === branchId);
    if (!valid) branchId = user.defaultBranchId || branches[0]?._id || (user.role.allBranches ? 'all' : null);
    set({ accessToken: data.accessToken, user, company: data.company, branches, branchId, ready: true });
  },

  async bootstrap() {
    try {
      const data = await refreshSession();
      get().applySession(data);
      await get().loadSettings();
    } catch {
      set({ ready: true, accessToken: null, user: null });
    }
  },

  async login(username, password) {
    const r = await axios.post('/api/auth/login', { username, password }, { withCredentials: true });
    get().applySession(r.data.data);
    await get().loadSettings();
  },

  async loadSettings() {
    try {
      const r = await axios.get('/api/settings', { headers: { Authorization: `Bearer ${get().accessToken}` } });
      set({ settings: r.data.data });
    } catch { /* settings are optional for rendering */ }
  },

  async logout() {
    try {
      await axios.post('/api/auth/logout', {}, { withCredentials: true, headers: { Authorization: `Bearer ${get().accessToken}` } });
    } catch { /* ignore */ }
    set({ accessToken: null, user: null, branches: [], company: null });
  },

  setBranch(branchId) {
    try { localStorage.setItem(BRANCH_KEY, branchId); } catch { /* ignore */ }
    set({ branchId });
  },
}));

bindAuth({
  get: () => useAuth.getState(),
  fail: () => useAuth.setState({ accessToken: null, user: null }),
  token: (data) => useAuth.getState().applySession(data),
});
