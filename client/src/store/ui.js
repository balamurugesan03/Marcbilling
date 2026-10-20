import { create } from 'zustand';

export const useUI = create((set, get) => ({
  theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
  confirmState: null,

  toggleTheme() {
    const theme = get().theme === 'dark' ? 'light' : 'dark';
    document.documentElement.classList.toggle('dark', theme === 'dark');
    try { localStorage.setItem('fpos-theme', theme); } catch { /* ignore */ }
    set({ theme });
  },

  /** Promise-based confirmation dialog: await confirm({ title, message, danger, input }) */
  confirm(opts) {
    return new Promise((resolve) => set({ confirmState: { ...opts, resolve } }));
  },
  closeConfirm(result) {
    get().confirmState?.resolve(result);
    set({ confirmState: null });
  },
}));

export const confirm = (opts) => useUI.getState().confirm(opts);
