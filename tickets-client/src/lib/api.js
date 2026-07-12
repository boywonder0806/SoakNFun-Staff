import axios from 'axios';

const api = axios.create({ baseURL: '/api' });

api.interceptors.request.use(config => {
  const token = localStorage.getItem('tickets_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  res => res,
  err => {
    const isAuthEndpoint = err.config?.url?.startsWith('/auth/');
    if (err.response?.status === 401 && !isAuthEndpoint) {
      localStorage.removeItem('tickets_token');
      window.location.href = '/';
    }
    return Promise.reject(err);
  }
);

export default api;
