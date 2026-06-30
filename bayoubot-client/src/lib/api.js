import axios from 'axios';

const api = axios.create({ baseURL: '/api' });

api.interceptors.request.use(config => {
  const token = localStorage.getItem('bayoubot_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  res => res,
  err => {
    const isAuthEndpoint = err.config?.url?.startsWith('/auth/');
    const status = err.response?.status;
    if ((status === 401 || status === 403) && !isAuthEndpoint) {
      localStorage.removeItem('bayoubot_token');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export default api;
