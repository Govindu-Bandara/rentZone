import DashboardLayout from './DashboardLayout';
import { LayoutDashboard, Users, Home, Shield, AlertTriangle, Activity } from 'lucide-react';

const NAV_ITEMS = [
  {
    key: 'dashboard',
    label: 'Dashboard',
    path: '/admin/dashboard',
    icon: <LayoutDashboard size={18} />,
  },
  {
    key: 'users',
    label: 'Users',
    path: '/admin/users',
    icon: <Users size={18} />,
  },
  {
    key: 'properties',
    label: 'Properties',
    path: '/admin/properties',
    icon: <Home size={18} />,
  },
  {
    key: 'verification',
    label: 'Verification Queue',
    path: '/admin/verification',
    icon: <Shield size={18} />,
  },
  {
    key: 'fraud',
    label: 'Fraud Alerts',
    path: '/admin/fraud',
    icon: <AlertTriangle size={18} />,
  },
  {
    key: 'activity',
    label: 'Activity Log',
    path: '/admin/activity',
    icon: <Activity size={18} />,
  },
];

export default function AdminLayout({ children }) {
  return <DashboardLayout navItems={NAV_ITEMS}>{children}</DashboardLayout>;
}