import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Toaster } from 'react-hot-toast';

// Pages
import Landing          from './components/common/Landing';
import Login            from './components/auth/Login';
import Register         from './components/auth/Register';
import VerifyEmail      from './components/auth/VerifyEmail';
import RenterDashboard  from './pages/Renter/RenterDashboard';
import OwnerDashboard   from './pages/Owner/OwnerDashboard';
import CreateNewListing from './pages/Owner/CreateNewListing';
import CreatedListings  from './pages/Owner/CreatedListings';
import EditListing      from './pages/Owner/EditListing';
import AdminDashboard   from './pages/Admin/AdminDashboard';
import AdminUsers       from './pages/Admin/AdminUsers';
import AdminProperties  from './pages/Admin/AdminProperties';
import AdminListings    from './pages/Admin/AdminListings';
import AdminFraudMonitoring from './pages/Admin/AdminFraudMonitoring';
import AdminSystemLogs  from './pages/Admin/AdminSystemLogs';
import SearchRentals    from './pages/Renter/SearchRentals';
import SavedProperties  from './pages/Renter/SavedProperties';
import Bookings         from './pages/Renter/Bookings';
import RenterMessages   from './pages/Renter/RenterMessages';
import OwnerMessages    from './pages/Owner/OwnerMessages';
import UserProfile      from './components/common/UserProfile';
import OwnerBookings    from './pages/Owner/OwnerBookings';
import Notifications    from './components/common/Notifications';
import ForgotPassword   from './components/auth/ForgotPassword';
import ResetPassword    from './components/auth/ResetPassword';

import './index.css';

function ProtectedRoute({ children, allowedRoles }) {
  const { user, isAuthenticated } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (allowedRoles && !allowedRoles.includes(user.role)) {
    if (user.role === 'admin') return <Navigate to="/admin/dashboard" replace />;
    if (user.role === 'owner') return <Navigate to="/owner/dashboard" replace />;
    return <Navigate to="/renter/dashboard" replace />;
  }
  return children;
}

function PublicRoute({ children }) {
  const { user, isAuthenticated, logout } = useAuth();
  if (isAuthenticated) {
    if (!user || !user.role) { logout(); return children; }
    if (user.role === 'admin')  return <Navigate to="/admin/dashboard" replace />;
    if (user.role === 'owner')  return <Navigate to="/owner/dashboard" replace />;
    if (user.role === 'renter') return <Navigate to="/renter/dashboard" replace />;
    logout();
  }
  return children;
}

function AppRoutes() {
  return (
    <Routes>
      {/* ── Public ── */}
      <Route path="/" element={<Landing />} />
      <Route path="/login"    element={<PublicRoute><Login /></PublicRoute>} />
      <Route path="/register" element={<PublicRoute><Register /></PublicRoute>} />
      <Route path="/verify-email" element={<VerifyEmail />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />

      {/* ── Renter ── */}
      <Route path="/renter/dashboard"
        element={<ProtectedRoute allowedRoles={['renter']}><RenterDashboard /></ProtectedRoute>} />
      <Route path="/renter/search"
        element={<ProtectedRoute allowedRoles={['renter']}><SearchRentals /></ProtectedRoute>} />
      <Route path="/renter/saved"
        element={<ProtectedRoute allowedRoles={['renter']}><SavedProperties /></ProtectedRoute>} />
      <Route path="/renter/bookings"
        element={<ProtectedRoute allowedRoles={['renter']}><Bookings /></ProtectedRoute>} />
      <Route path="/renter/messages"
        element={<ProtectedRoute allowedRoles={['renter']}><RenterMessages /></ProtectedRoute>} />
      <Route path="/renter/profile"
        element={<ProtectedRoute allowedRoles={['renter']}><UserProfile /></ProtectedRoute>} />
      <Route path="/renter/notifications"
        element={<ProtectedRoute allowedRoles={['renter']}><Notifications /></ProtectedRoute>} />

      {/* ── Owner ── */}
      <Route path="/owner/dashboard"
        element={<ProtectedRoute allowedRoles={['owner']}><OwnerDashboard /></ProtectedRoute>} />
      <Route path="/owner/listings"
        element={<ProtectedRoute allowedRoles={['owner']}><CreatedListings /></ProtectedRoute>} />
      <Route path="/owner/create-listing"
        element={<ProtectedRoute allowedRoles={['owner']}><CreateNewListing /></ProtectedRoute>} />
      <Route path="/owner/add-property"
        element={<ProtectedRoute allowedRoles={['owner']}><CreateNewListing /></ProtectedRoute>} />
      <Route path="/owner/properties/:id/edit"
        element={<ProtectedRoute allowedRoles={['owner']}><EditListing /></ProtectedRoute>} />
      <Route path="/owner/bookings"
        element={<ProtectedRoute allowedRoles={['owner']}><OwnerBookings /></ProtectedRoute>} />
      <Route path="/owner/messages"
        element={<ProtectedRoute allowedRoles={['owner']}><OwnerMessages /></ProtectedRoute>} />
      <Route path="/owner/profile"
        element={<ProtectedRoute allowedRoles={['owner']}><UserProfile /></ProtectedRoute>} />
      <Route path="/owner/notifications"
        element={<ProtectedRoute allowedRoles={['owner']}><Notifications /></ProtectedRoute>} />

      {/* ── Admin ── */}
      <Route path="/admin/dashboard"
        element={<ProtectedRoute allowedRoles={['admin']}><AdminDashboard /></ProtectedRoute>} />
      <Route path="/admin/users"
        element={<ProtectedRoute allowedRoles={['admin']}><AdminUsers /></ProtectedRoute>} />
      <Route path="/admin/properties"
        element={<ProtectedRoute allowedRoles={['admin']}><AdminProperties /></ProtectedRoute>} />
      <Route path="/admin/verification"
        element={<ProtectedRoute allowedRoles={['admin']}><AdminListings /></ProtectedRoute>} />
      <Route path="/admin/fraud"
        element={<ProtectedRoute allowedRoles={['admin']}><AdminFraudMonitoring /></ProtectedRoute>} />
      <Route path="/admin/activity"
        element={<ProtectedRoute allowedRoles={['admin']}><AdminSystemLogs /></ProtectedRoute>} />

      {/* ── Fallback ── */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Toaster
          position="top-right"
          toastOptions={{ duration: 3000, style: { fontSize: '14px' } }}
        />
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  );
}