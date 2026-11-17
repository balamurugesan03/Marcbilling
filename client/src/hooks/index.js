import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { get, errMsg } from '../lib/api';
import { useAuth } from '../store/auth';

export function useDebounce(value, delay = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

/** Fetch helper bound to the selected branch: refetches when url/params/branch change. */
export function useFetch(url, params = {}, { enabled = true, deps = [] } = {}) {
  const branchId = useAuth((s) => s.branchId);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(Boolean(enabled && url));
  const [error, setError] = useState(null);
  const key = JSON.stringify(params);
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!enabled || !url) return;
    const my = ++seq.current;
    setLoading(true);
    try {
      const d = await get(url, JSON.parse(key));
      if (my === seq.current) { setData(d); setError(null); }
    } catch (e) {
      if (my === seq.current) { setError(errMsg(e)); toast.error(errMsg(e)); }
    } finally {
      if (my === seq.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, key, enabled, branchId, ...deps]);

  useEffect(() => { load(); }, [load]);
  return { data, loading, error, reload: load, setData };
}

/**
 * Global keyboard shortcuts. map: { 'F2': fn, 'ctrl+q': fn, 'Delete': fn }
 * Function keys always fire; plain keys are ignored while typing in inputs unless allowInInputs.
 * Return false from a handler to let the key pass on to other listeners.
 */
export function useHotkeys(map, { enabled = true, allowInInputs = [] } = {}) {
  const ref = useRef(map);
  ref.current = map;
  useEffect(() => {
    if (!enabled) return undefined;
    const onKey = (e) => {
      const parts = [];
      if (e.ctrlKey || e.metaKey) parts.push('ctrl');
      if (e.altKey) parts.push('alt');
      if (e.shiftKey && e.key.length > 1) parts.push('shift');
      parts.push(e.key.length === 1 ? e.key.toLowerCase() : e.key);
      const combo = parts.join('+');
      const fn = ref.current[combo];
      if (!fn) return;
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
      const isFn = /^F\d{1,2}$/.test(e.key) || combo.startsWith('ctrl+') || combo.startsWith('alt+') || e.key === 'Escape';
      if (typing && !isFn && !allowInInputs.includes(combo)) return;
      // a handler returning false declines the key: the browser default (F1 help, F5 reload…)
      // stays blocked, but the key still reaches other listeners such as an open popup
      e.preventDefault();
      if (fn(e) === false) return;
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [enabled, allowInInputs.join(',')]);
}

/**
 * Detects USB/Bluetooth barcode scanners (keyboard wedge): fast key bursts ending with Enter,
 * even when focus is not in an input. Calls onScan(code).
 */
export function useScanner(onScan, { enabled = true, minLength = 4, maxGap = 40 } = {}) {
  const cb = useRef(onScan);
  cb.current = onScan;
  useEffect(() => {
    if (!enabled) return undefined;
    let buf = '';
    let last = 0;
    const onKey = (e) => {
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return; // inputs handle their own Enter
      const now = performance.now();
      if (now - last > maxGap * 3) buf = '';
      last = now;
      if (e.key === 'Enter') {
        if (buf.length >= minLength) {
          e.preventDefault();
          cb.current(buf);
        }
        buf = '';
      } else if (e.key.length === 1) {
        buf += e.key;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, minLength, maxGap]);
}

/** Listen to app-level events dispatched from the socket layer. */
export function useAppEvent(name, handler) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const fn = (e) => ref.current(e.detail);
    window.addEventListener(`fpos:${name}`, fn);
    return () => window.removeEventListener(`fpos:${name}`, fn);
  }, [name]);
}
