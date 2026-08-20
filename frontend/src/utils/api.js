import axios from 'axios';
import { API_BASE } from './config';

const api = axios.create({
  baseURL: `${API_BASE}/api`,
  timeout: 30000,
  // axios sets Content-Type automatically (multipart for FormData, json for objects)
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    const status = err.response?.status;
    const url = err.config?.url || '';

    // A 401 from the login call means "wrong password", not "session expired".
    // Redirecting on it reloaded the page and wiped the error toast before the
    // cashier could read why the login failed — so leave it to the caller.
    const isAuthAttempt = url.includes('/auth/login') || url.includes('/auth/change-password');

    if (status === 401 && !isAuthAttempt) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      // Only bounce if we are not already sitting on the login screen, and use
      // replace() so the expired page does not linger in browser history.
      if (!window.location.pathname.startsWith('/login')) {
        window.location.replace('/login?expired=1');
      }
    }
    return Promise.reject(err);
  }
);

export default api;
