import axios from 'axios';

const api = axios.create({ baseURL: '/api' });

api.interceptors.request.use(config => {
  const token = localStorage.getItem('rc_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  res => res,
  err => {
    const isAuthEndpoint = err.config?.url?.startsWith('/auth/');
    const status = err.response?.status;
    if ((status === 401 || status === 403) && !isAuthEndpoint) {
      const message = err.response?.data?.error;
      if (message) sessionStorage.setItem('rc_session_error', message);
      localStorage.removeItem('rc_token');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export default api;
