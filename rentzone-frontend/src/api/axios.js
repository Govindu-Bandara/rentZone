import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_URL ;

const api = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' },
  timeout: 15000,
});

// Request interceptor — inject access token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('rz_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor — handle 401
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('rz_token');
      localStorage.removeItem('rz_user');
      localStorage.removeItem('rz_refresh');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default api;