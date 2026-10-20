import axios from 'axios';

/** Axios instance: attaches access token + selected branch, refreshes the token once on 401. */
const api = axios.create({ baseURL: '/api', withCredentials: true, timeout: 60000 });

let getState = () => ({});
let onAuthFail = () => {};
let setToken = () => {};
export function bindAuth({ get, fail, token }) {
  getState = get;
  onAuthFail = fail;
  setToken = token;
}

api.interceptors.request.use((config) => {
  const { accessToken, branchId } = getState();
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  if (branchId && !config.headers['x-branch-id']) config.headers['x-branch-id'] = branchId;
  return config;
});

let refreshing = null;
export function refreshSession() {
  if (!refreshing) {
    refreshing = axios.post('/api/auth/refresh', {}, { withCredentials: true })
      .then((r) => {
        if (!r.data.data) throw new Error('No session');
        return r.data.data;
      })
      .finally(() => { setTimeout(() => { refreshing = null; }, 0); });
  }
  return refreshing;
}

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const { config, response } = error;
    if (response?.status === 401 && !config._retry && !config.url.startsWith('/auth/')) {
      config._retry = true;
      try {
        const data = await refreshSession();
        setToken(data);
        config.headers.Authorization = `Bearer ${data.accessToken}`;
        return api(config);
      } catch {
        onAuthFail();
      }
    }
    return Promise.reject(error);
  },
);

/** Unwraps { success, data } and turns errors into readable messages. */
export const errMsg = (e) => e?.response?.data?.message || (e?.code === 'ECONNABORTED' ? 'Request timed out' : e?.message) || 'Something went wrong';

export const get = (url, params, cfg) => api.get(url, { params, ...cfg }).then((r) => r.data.data);
export const post = (url, body, cfg) => api.post(url, body, cfg).then((r) => r.data.data);
export const put = (url, body, cfg) => api.put(url, body, cfg).then((r) => r.data.data);
export const del = (url, cfg) => api.delete(url, cfg).then((r) => r.data.data);

export default api;
