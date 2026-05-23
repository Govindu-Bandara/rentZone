import axios from 'axios';
import { clearAuthStorage, getStoredRefreshToken } from '../utils/auth';

// During local development we route API calls through the Vite dev server proxy
// so the browser sees same-origin responses and avoids CORS issues.
// The proxy maps the `/production` path to the API Gateway target configured
// in `vite.config.js`.
const API_BASE_URL = import.meta.env.DEV
  ? (import.meta.env.VITE_API_PROXY_PATH || '/production')
  : (import.meta.env.VITE_API_BASE_URL || 'https://z99qed07b8.execute-api.ap-southeast-2.amazonaws.com/production');

console.log('API Base URL:', API_BASE_URL, 'DEV=', import.meta.env.DEV);

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 10000,
});

// ── Token-refresh state ──────────────────────────────────────────────────────
// A plain axios instance used ONLY for the /auth/refresh call so it never
// triggers the interceptor below (which would cause infinite loops).
const refreshClient = axios.create({ baseURL: API_BASE_URL, timeout: 10000 });

let isRefreshing = false;
// Queue of { resolve, reject } for requests that arrived while a refresh is in flight
let pendingQueue = [];

function processQueue(error, token) {
  pendingQueue.forEach((p) => (error ? p.reject(error) : p.resolve(token)));
  pendingQueue = [];
}

function forceLogout() {
  clearAuthStorage();
  // Notify AuthContext (if mounted) and let it redirect
  window.dispatchEvent(new Event('auth:logout'));
}
// ────────────────────────────────────────────────────────────────────────────

// Request interceptor
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('accessToken');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    console.log('API Request:', config.method.toUpperCase(), config.url);
    return config;
  },
  (error) => {
    console.error('Request Error:', error);
    return Promise.reject(error);
  }
);

// Response interceptor
api.interceptors.response.use(
  (response) => {
    console.log('API Response:', response.config.url, response.status);
    return response;
  },
  async (error) => {
    const originalRequest = error.config;

    console.error('API Error:', error.response?.status, error.response?.data || error.message);

    // ── Handle expired access token ──────────────────────────────────────────
    if (error.response?.status === 401 && !originalRequest._retry) {
      const refreshToken = getStoredRefreshToken();

      // No refresh token available — force logout immediately
      if (!refreshToken) {
        forceLogout();
        return Promise.reject(error);
      }

      // Another request is already refreshing — queue this one
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          pendingQueue.push({ resolve, reject });
        })
          .then((newToken) => {
            originalRequest.headers.Authorization = `Bearer ${newToken}`;
            return api(originalRequest);
          })
          .catch((err) => Promise.reject(err));
      }

      // This request will drive the refresh
      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const { data } = await refreshClient.post('/auth/refresh', { refreshToken });
        const { accessToken: newToken, refreshToken: newRefresh } = data;

        // Persist updated tokens
        localStorage.setItem('rz_token', newToken);
        localStorage.setItem('accessToken', newToken);
        if (newRefresh) {
          localStorage.setItem('rz_refresh', newRefresh);
          localStorage.setItem('refreshToken', newRefresh);
        }

        // Update default header for future requests
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
    // ────────────────────────────────────────────────────────────────────────

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
  // Public endpoint — no auth required (used on Landing page)
  getPublicProperties: (params) => api.get('/public/houses', { params }),

  // Authenticated endpoints
  getProperties:    (params)     => api.get('/house', { params }),
  getProperty:      (id)         => api.get(`/house/${id}`),
  createProperty:   (data)       => api.post('/house', data),
  updateProperty:   (id, data)   => api.put(`/house/${id}`, data),
  deleteProperty:   (id)         => api.delete(`/house/${id}`),
  searchProperties: (params)     => api.get('/house', { params }),

  // Owner-specific
  getOwnerListings: (params)     => api.get('/owner/listings', { params }),
};

// ==================== UPLOAD API ====================
export const uploadAPI = {
  getUploadUrl: (fileName, fileType) => api.post('/get-upload-url', { fileName, fileType }),
  getNicUploadUrl: (fileName, fileType, uploadType, sessionId) =>
    api.post('/get-upload-url', { fileName, fileType, uploadType, sessionId }),
};

// ==================== BOOKING API ====================
export const bookingAPI = {
  // Renter
  createBookingRequest: (data)     => api.post('/bookings/request', data),
  getRenterBookings:    (params)   => api.get('/renter/bookings', { params }),
  updateRenterBooking:  (id, data) => api.put(`/renter/bookings/${id}`, data),
  getRenterBookingById: (id)       => api.get('/renter/bookings', { params: { bookingId: id, limit: 1 } }),

  // Owner
  getOwnerBookings:  (params)   => api.get('/owner/bookings', { params }),
  updateOwnerBooking:(id, data) => api.put(`/owner/bookings/${id}`, data),
};

// ==================== PAYMENT API ====================
export const paymentAPI = {
  getPaymentDetails: (bookingId)       => api.get(`/payments/${bookingId}`),
  processPayment:    (bookingId, data) => api.post(`/payments/${bookingId}`, data),
};

// ==================== FAVORITES API ====================
// Exported as BOTH favoriteAPI (legacy) and favoritesAPI (new dashboard)
export const favoriteAPI = {
  getFavorites:  (params)  => api.get('/favourites', { params }),
  addFavorite:   (houseId) => api.post('/favourites', { houseId }),
  removeFavorite:(houseId) => api.delete(`/favourites/${houseId}`),
};

export const favoritesAPI = {
  getAll:  (params)  => api.get('/favourites', { params }),
  add:     (houseId) => api.post('/favourites', { houseId }),
  remove:  (houseId) => api.delete(`/favourites/${houseId}`),
};

// ==================== MESSAGE API ====================
// REST endpoints hit the rentzone-get-messages Lambda.
// Real-time sending / delivery / read receipts / typing are handled
// via WebSocket (socket.js). The REST methods here are for initial
// data loads and as fallbacks when the socket is unavailable.
export const messageAPI = {
  /**
   * GET /messages
   * Returns all conversations for the authenticated user, sorted by
   * lastMessageAt descending. Each item includes otherUser, lastMessage,
   * unreadCount, and participantsMeta.
   */
  getConversations: () => api.get('/messages'),

  /**
   * GET /messages?conversationId=<id>
   * Returns paginated messages + conversation meta for a single thread.
   * Called on initial conversation open.
   */
  getMessages: (conversationId) =>
    api.get('/messages', { params: { conversationId } }),

  /**
   * POST /sendMessage  (REST fallback only)
   * Used when the WebSocket is not open.
   * Payload: { receiverId, message, messageType?, attachments?, tempId? }
   * Prefer sendWS('sendMessage', payload) for real-time delivery.
   */
  sendMessage: (payload) => api.post('/sendMessage', payload),

  /**
   * PUT /messages/read  (REST fallback only)
   * Marks messages as read when the socket is unavailable.
   * Payload: { conversationId?, messageIds? }
   * Prefer sendWS('markAsRead', payload) for real-time read receipts.
   */
  markAsRead: (payload) => api.put('/messages/read', payload),
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
  getDashboard:       ()         => api.get('/renter/dashboard'),
  getBookings:        (params)   => api.get('/renter/bookings', { params }),
  updateBooking:      (id, data) => api.put(`/renter/bookings/${id}`, data),
  getRecommendations: (params)   => api.get('/recommendations', { params }),
  getRecentlyViewed:  (params)   => api.get('/recently-viewed', { params }),
  // Aliases used by RenterDashboard
  getSaved:           (params)   => api.get('/favourites', { params }),
};

// ==================== ADMIN API ====================
export const adminAPI = {
  getDashboard: () => api.get('/admin/dashboard'),

  // Users
  getUsers:      (params)   => api.get('/admin/users', { params }),
  getUserDetail: (id)       => api.get(`/admin/users/${id}`),
  updateUser:    (id, data) => api.put(`/admin/users/${id}`, data),
  deleteUser:    (id)       => api.delete(`/admin/users/${id}`),

  // Listings verification
  getVerificationQueue: (params)   => api.get('/admin/verify-listings', { params }),
  verifyListing:        (id, data) => api.put(`/admin/verify-listings/${id}`, data),

  // Fraud
  getFraudMonitoring: (params)   => api.get('/admin/fraud', { params }),
  resolveFraudCase:   (id, data) => api.put(`/admin/fraud/${id}`, data),
  runFraudScan:       (data)     => api.post('/admin/fraud', data),

  // Logs
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