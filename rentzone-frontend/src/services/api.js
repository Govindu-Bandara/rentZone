import axios from 'axios';
import { clearAuthStorage, getStoredRefreshToken } from '../utils/auth';

const API_BASE_URL = import.meta.env.DEV
  ? (import.meta.env.VITE_API_PROXY_PATH || '/production')
  : (import.meta.env.VITE_API_URL || 'https://z99qed07b8.execute-api.ap-southeast-2.amazonaws.com/production');

console.log('API Base URL:', API_BASE_URL, 'DEV=', import.meta.env.DEV);

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 10000,
});

// Plain client used ONLY for token refresh — never triggers the response interceptor below.
const refreshClient = axios.create({ baseURL: API_BASE_URL, timeout: 10000 });

let isRefreshing = false;
let pendingQueue = [];

function processQueue(error, token) {
  pendingQueue.forEach((p) => (error ? p.reject(error) : p.resolve(token)));
  pendingQueue = [];
}

function forceLogout() {
  clearAuthStorage();
  window.dispatchEvent(new Event('auth:logout'));
}

// ── Request interceptor ────────────────────────────────────────────────────
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('accessToken') || localStorage.getItem('rz_token');
    if (token) config.headers.Authorization = `Bearer ${token}`;
    console.log('API Request:', config.method?.toUpperCase(), config.url);
    return config;
  },
  (error) => {
    console.error('Request Error:', error);
    return Promise.reject(error);
  }
);

// ── Response interceptor ───────────────────────────────────────────────────
api.interceptors.response.use(
  (response) => {
    console.log('API Response:', response.config.url, response.status);
    return response;
  },
  async (error) => {
    const originalRequest = error.config;
    console.error('API Error:', error.response?.status, error.response?.data || error.message);

    if (error.response?.status === 401 && !originalRequest._retry) {
      const refreshToken = getStoredRefreshToken();
      if (!refreshToken) { forceLogout(); return Promise.reject(error); }

      if (isRefreshing) {
        return new Promise((resolve, reject) => { pendingQueue.push({ resolve, reject }); })
          .then((newToken) => { originalRequest.headers.Authorization = `Bearer ${newToken}`; return api(originalRequest); })
          .catch((err) => Promise.reject(err));
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const { data } = await refreshClient.post('/auth/refresh', { refreshToken });
        const { accessToken: newToken, refreshToken: newRefresh } = data;

        localStorage.setItem('rz_token', newToken);
        localStorage.setItem('accessToken', newToken);
        if (newRefresh) {
          localStorage.setItem('rz_refresh', newRefresh);
          localStorage.setItem('refreshToken', newRefresh);
        }

        api.defaults.headers.common.Authorization = `Bearer ${newToken}`;
        processQueue(null, newToken);
        originalRequest.headers.Authorization = `Bearer ${newToken}`;
        return api(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError, null);
        forceLogout();
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    const errorMessage =
      error.response?.data?.message ||
      error.response?.data?.error ||
      error.message ||
      'An error occurred';

    return Promise.reject({
      error: errorMessage,
      status: error.response?.status,
      data: error.response?.data,
    });
  }
);

// ==================== AUTH API ====================
export const authAPI = {
  login:         (credentials) => api.post('/auth/login', credentials),
  register:      (userData)    => api.post('/auth/register', userData),
  registerAdmin: (userData)    => api.post('/auth/admin/register', userData),
  logout:        ()            => api.post('/auth/logout'),
  refreshToken:  (rt)          => api.post('/auth/refresh', { refreshToken: rt }),
  verifyEmail:   (data)        => api.post('/auth/verify-email', data),
  resendOTP:     (data)        => api.post('/auth/resend-otp', data),
  forgotPassword: (email)      => api.post('/auth/forgot-password', { email }),
  resetPassword:  (token, email, newPassword) =>
    api.post('/auth/reset-password', { token, email, newPassword }),
};

// ==================== USER API ====================
export const userAPI = {
  getProfile:    ()     => api.get('/user/profile'),
  updateProfile: (data) => api.put('/user/profile', data),
};

// ==================== LANDING API ====================
export const landingAPI = {
  getStats: () => api.get('/landing'),
};

// ==================== PROPERTY API ====================
export const propertyAPI = {
  getPublicProperties: (params)   => api.get('/public/houses', { params }),
  getProperties:       (params)   => api.get('/house', { params }),
  getProperty:         (id)       => api.get(`/house/${id}`),
  createProperty:      (data)     => api.post('/house', data),
  updateProperty:      (id, data) => api.put(`/house/${id}`, data),
  deleteProperty:      (id)       => api.delete(`/house/${id}`),
  searchProperties:    (params)   => api.get('/house', { params }),
  getOwnerListings:    (params)   => api.get('/owner/listings', { params }),
};

// ==================== UPLOAD API ====================
export const uploadAPI = {
  getUploadUrl: (fileName, fileType) =>
    api.post('/get-upload-url', { fileName, fileType }),
  getNicUploadUrl: (fileName, fileType, uploadType, sessionId) =>
    api.post('/get-upload-url', { fileName, fileType, uploadType, sessionId }),
};

// ==================== BOOKING API ====================
export const bookingAPI = {
  createBookingRequest: (data)     => api.post('/bookings/request', data),
  getRenterBookings:    (params)   => api.get('/renter/bookings', { params }),
  updateRenterBooking:  (id, data) => api.put(`/renter/bookings/${id}`, data),
  getRenterBookingById: (id)       => api.get('/renter/bookings', { params: { bookingId: id, limit: 1 } }),
  getOwnerBookings:     (params)   => api.get('/owner/bookings', { params }),
  updateOwnerBooking:   (id, data) => api.put(`/owner/bookings/${id}`, data),
};

// ==================== PAYMENT API ====================
export const paymentAPI = {
  getPaymentDetails: (bookingId)       => api.get(`/payments/${bookingId}`),
  processPayment:    (bookingId, data) => api.post(`/payments/${bookingId}`, data),
};

// ==================== FAVORITES API ====================
export const favoriteAPI = {
  getFavorites:   (params)  => api.get('/favourites', { params }),
  addFavorite:    (houseId) => api.post('/favourites', { houseId }),
  removeFavorite: (houseId) => api.delete(`/favourites/${houseId}`),
};

// Alias for components that import favoritesAPI (plural)
export const favoritesAPI = {
  getAll:  (params)  => api.get('/favourites', { params }),
  add:     (houseId) => api.post('/favourites', { houseId }),
  remove:  (houseId) => api.delete(`/favourites/${houseId}`),
};

// ==================== MESSAGE API ====================
export const messageAPI = {
  getConversations: ()               => api.get('/messages'),
  getMessages:      (conversationId) => api.get('/messages', { params: { conversationId } }),
  sendMessage:      (payload)        => api.post('/sendMessage', payload),
  markAsRead:       (payload)        => api.put('/messages/read', payload),
};

// ==================== NOTIFICATION API ====================
export const notificationAPI = {
  getNotifications:   (params) => api.get('/notification', { params }),
  markAsRead:         (id)     => api.put(`/notification/${id}`, { action: 'markAsRead' }),
  markAllAsRead:      ()       => api.put('/notification/all', { action: 'markAllAsRead' }),
  deleteNotification: (id)     => api.put(`/notification/${id}`, { action: 'delete' }),
};

// ==================== OWNER API ====================
export const ownerAPI = {
  getListings:   (params)   => api.get('/owner/listings', { params }),
  getDashboard:  ()         => api.get('/owner/dashboard'),
  getBookings:   (params)   => api.get('/owner/bookings', { params }),
  updateBooking: (id, data) => api.put(`/owner/bookings/${id}`, data),
};

// ==================== RENTER API ====================
export const renterAPI = {
  getDashboard:       ()       => api.get('/renter/dashboard'),
  getBookings:        (params) => api.get('/renter/bookings', { params }),
  updateBooking:      (id, data) => api.put(`/renter/bookings/${id}`, data),
  getRecommendations: (params) => api.get('/recommendations', { params }),
  getRecentlyViewed:  (params) => api.get('/recently-viewed', { params }),
  getSaved:           (params) => api.get('/favourites', { params }),
};

// ==================== ADMIN API ====================
export const adminAPI = {
  getDashboard: () => api.get('/admin/dashboard'),

  // Users — params can include { locked: 'true' } to filter locked accounts
  getUsers:      (params)   => api.get('/admin/users', { params }),
  getUserDetail: (id)       => api.get(`/admin/users/${id}`),
  updateUser:    (id, data) => api.put(`/admin/users/${id}`, data),
  deleteUser:    (id)       => api.delete(`/admin/users/${id}`),

  // Listings verification
  getVerificationQueue: (params)   => api.get('/admin/verify-listings', { params }),
  verifyListing:        (id, data) => api.put(`/admin/verify-listings/${id}`, data),

  // Fraud monitoring
  getFraudMonitoring: (params)   => api.get('/admin/fraud', { params }),
  resolveFraudCase:   (id, data) => api.put(`/admin/fraud/${id}`, data),
  runFraudScan:       (data)     => api.post('/admin/fraud', data),

  // System logs
  getSystemLogs: (params) => api.get('/admin/logs', { params }),
  createLog:     (data)   => api.post('/admin/logs', data),
};

// ==================== DASHBOARD API (compat alias) ====================
export const dashboardAPI = {
  getRenterDashboard: () => api.get('/renter/dashboard'),
  getOwnerDashboard:  () => api.get('/owner/dashboard'),
  getAdminDashboard:  () => api.get('/admin/dashboard'),
};

export default api;