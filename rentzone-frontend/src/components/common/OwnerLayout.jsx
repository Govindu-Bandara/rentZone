import DashboardLayout from './DashboardLayout';
import { Home, Calendar, MessageSquare, BarChart2, PlusCircle } from 'lucide-react';

const NAV_ITEMS = [
  {
    key: 'dashboard',
    label: 'Dashboard',
    path: '/owner/dashboard',
    icon: <Home size={18} />,
  },
  {
    key: 'create-listing',
    label: 'Create New Listing',
    path: '/owner/create-listing',
    icon: <PlusCircle size={18} />,
  },
  {
    key: 'listings',
    label: 'My Listings',
    path: '/owner/listings',
    icon: <BarChart2 size={18} />,
  },
  
  {
    key: 'bookings',
    label: 'Bookings',
    path: '/owner/bookings',
    icon: <Calendar size={18} />,
  },
  {
    key: 'messages',
    label: 'Messages',
    path: '/owner/messages',
    icon: <MessageSquare size={18} />,
  },
];

export default function OwnerLayout({ children }) {
  return <DashboardLayout navItems={NAV_ITEMS}>{children}</DashboardLayout>;
}