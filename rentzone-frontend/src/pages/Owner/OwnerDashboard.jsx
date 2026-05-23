// pages/owner/OwnerDashboard.jsx
import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { ownerAPI, propertyAPI } from '../../services/api';
import OwnerLayout from '../../components/common/OwnerLayout';
import ActionConfirmModal from '../../components/common/ActionConfirmModal';
import {
  Home, Calendar, MessageCircle,
  Plus, CheckCircle, Clock, XCircle, AlertCircle,
} from 'lucide-react';

/* ── Status badge ── */
function StatusBadge({ status }) {
  const map = {
    pending:   { cls: 'bg-yellow-100 text-yellow-800', Icon: Clock },
    approved:  { cls: 'bg-green-100  text-green-800',  Icon: CheckCircle },
    rejected:  { cls: 'bg-red-100    text-red-800',    Icon: XCircle },
    cancelled: { cls: 'bg-gray-100   text-gray-800',   Icon: AlertCircle },
  };
  const { cls, Icon } = map[status] || map.pending;
  return (
    <span className={`px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-1 w-fit ${cls}`}>
      <Icon size={13} />
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

/**
 * Compute the amount shown to the owner — matches what the renter sees:
 *   • Monthly rental  → 1st month rent + security deposit
 *   • Daily rental    → totalAmount (already = nights × rate + deposit)
 *
 * The booking document stores:
 *   totalAmount  = monthlyRent × duration + securityDeposit   (monthly)
 *   totalAmount  = nightlyRate × nights   + securityDeposit   (daily)
 *   monthlyRent  = price per month (stored on the booking)
 *   duration     = number of months / weeks / days
 *
 * So:  securityDeposit = totalAmount − monthlyRent × duration
 *      displayAmount   = monthlyRent + securityDeposit
 */
function resolveDisplayAmount(booking) {
  if (!booking) return 0;

  const total       = Number(booking.totalAmount  || 0);
  const monthlyRent = Number(booking.monthlyRent  || 0);
  const duration    = Number(booking.duration     || 0);
  const isDailyRental = Boolean(booking.isDailyRental);

  // Daily rentals: totalAmount already equals (nights × rate + deposit) — use as-is
  if (isDailyRental) return total;

  // Monthly rentals: back-calculate the security deposit, then return 1st month + deposit
  if (monthlyRent > 0 && duration > 0) {
    const securityDeposit = total - monthlyRent * duration;
    return monthlyRent + securityDeposit;
  }

  // Fallback: can't decompose — return the stored total
  return total;
}

export default function OwnerDashboard() {
  const { user } = useAuth();

  const [stats,           setStats          ] = useState(null);
  const [bookingRequests, setBookingRequests ] = useState([]);
  const [properties,      setProperties     ] = useState([]);
  const [loading,         setLoading        ] = useState(true);
  const [actionBusyId,    setActionBusyId   ] = useState('');
  const [confirmTarget,   setConfirmTarget  ] = useState(null);
  const [confirmReason,   setConfirmReason  ] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const [dashboardResponse, listingsResponse] = await Promise.all([
          ownerAPI.getDashboard(),
          propertyAPI.getOwnerListings({ page: 1, limit: 3, sortBy: 'updated' }),
        ]);

        const dashboard = dashboardResponse.data?.dashboard || null;

        setStats(dashboard);
        setBookingRequests(dashboard?.bookings?.pendingRequests || []);
        setProperties(listingsResponse.data?.listings || []);
      } catch (err) {
        console.error('Owner dashboard error:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const performBookingAction = useCallback(async (booking, action, reason = '') => {
    const bookingId = booking?._id || booking?.id;
    if (!bookingId) return;
    setActionBusyId(String(bookingId));
    try {
      await ownerAPI.updateBooking(bookingId, { action, reason });
      setBookingRequests(prev => prev.filter((b) => String(b._id || b.id) !== String(bookingId)));
      setStats(prev => {
        if (!prev?.summary) return prev;
        return {
          ...prev,
          summary: {
            ...prev.summary,
            recentBookings: Math.max(0, (prev.summary.recentBookings || 0) - 1),
          },
        };
      });
    } catch (err) {
      console.error(`Failed to ${action} booking:`, err);
    } finally {
      setActionBusyId('');
    }
  }, []);

  const handleBookingAction = useCallback((booking, action) => {
    // For actions that need additional confirmation/reason we open modal.
    if (action === 'reject' || action === 'cancel') {
      setConfirmTarget({ booking, action });
      setConfirmReason('');
      return;
    }
    performBookingAction(booking, action);
  }, [performBookingAction]);

  const statCards = [
    {
      label: 'Add New Listing',
      value: '+',
      icon: Plus,
      bgColor: 'linear-gradient(135deg, #2563EB 0%, #14B8A6 100%)',
      textColor: '#fff',
      iconBg: 'rgba(255,255,255,0.2)',
      to: '/owner/create-listing',
    },
    {
      label: 'Total Listings',
      value: stats?.summary?.totalProperties ?? 0,
      icon: Home,
      bgColor: '#EFF6FF',
    },
    {
      label: 'Booking Requests',
      value: stats?.summary?.recentBookings ?? 0,
      icon: Calendar,
      bgColor: '#F0FDFA',
    },
    {
      label: 'Unread Messages',
      value: stats?.summary?.unreadMessages ?? 0,
      icon: MessageCircle,
      bgColor: '#FAF5FF',
    },
  ];

  if (loading) {
    return (
      <OwnerLayout>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 400 }}>
          <div style={{ textAlign: 'center' }}>
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-teal mx-auto mb-4" />
            <p style={{ color: 'var(--text-secondary)' }}>Loading your dashboard…</p>
          </div>
        </div>

          {/* Confirm modal for reject/cancel actions */}
          {confirmTarget && (
            <ActionConfirmModal
              title={confirmTarget.action === 'reject' ? 'Reject Booking Request?' : 'Cancel Booking?'}
              description={confirmTarget.booking?.propertyName ? `Are you sure you want to ${confirmTarget.action} the booking for "${confirmTarget.booking.propertyName}"?` : `Are you sure you want to ${confirmTarget.action} this booking?`}
              warningNote={confirmTarget.action === 'reject' ? 'The renter will be notified about the rejection.' : 'The renter will be notified about the cancellation.'}
              confirmLabel={confirmTarget.action === 'reject' ? 'Reject' : 'Confirm'}
              confirmColor={confirmTarget.action === 'reject' ? '#EF4444' : '#EF4444'}
              showReason={confirmTarget.action === 'reject' || confirmTarget.action === 'cancel'}
              reason={confirmReason}
              setReason={setConfirmReason}
              busy={actionBusyId === String(confirmTarget.booking?._id || confirmTarget.booking?.id)}
              onClose={() => { if (!actionBusyId) { setConfirmTarget(null); setConfirmReason(''); } }}
              onConfirm={async (r) => {
                await performBookingAction(confirmTarget.booking, confirmTarget.action, r || '');
                setConfirmTarget(null);
                setConfirmReason('');
              }}
            />
          )}
      </OwnerLayout>
    );
  }

  const formatPrice = (price) => {
    const amount = typeof price === 'object' ? price?.amount : price;
    const numeric = Number(amount);
    return Number.isFinite(numeric) ? `Rs ${numeric.toLocaleString()}` : 'N/A';
  };

  return (
    <OwnerLayout>
      {/* ── Header ── */}
      <div className="dashboard-header">
        <div>
          <h1 className="dashboard-title">{stats?.greeting || `Welcome back, ${user?.firstName || 'Owner'}! 🏠`}</h1>
          <p className="dashboard-subtitle">Manage your properties and track performance</p>
        </div>
      </div>

      {/* ── Stats ── */}
      <div className="stats-grid" style={{ marginBottom: 28 }}>
        {statCards.map((s, idx) => (
          s.to ? (
            <Link
              to={s.to}
              className="stat-card"
              key={s.label}
              style={{
                textDecoration: 'none',
                color: s.textColor || 'inherit',
                background: idx === 0 ? s.bgColor : 'transparent',
              }}
            >
              <div className="stat-icon" style={{ background: s.iconBg || s.bgColor, borderRadius: 8, padding: 10 }}>
                <s.icon size={22} style={{ color: s.textColor || '#374151' }} />
              </div>
              <div className="stat-content">
                <div className="stat-value" style={{ color: s.textColor || 'inherit' }}>{s.value}</div>
                <div className="stat-label" style={{ color: s.textColor || 'inherit' }}>{s.label}</div>
              </div>
            </Link>
          ) : (
            <div className="stat-card" key={s.label}>
              <div className="stat-icon" style={{ background: s.bgColor, borderRadius: 8, padding: 10 }}>
                <s.icon size={22} style={{ color: '#374151' }} />
              </div>
              <div className="stat-content">
                <div className="stat-value">{s.value}</div>
                <div className="stat-label">{s.label}</div>
              </div>
            </div>
          )
        ))}
      </div>

      {/* ── Booking Requests ── */}
      <div className="card" style={{ marginBottom: 28, padding: 0, overflow: 'hidden' }}>
        <div className="section-header" style={{ marginBottom: 0, padding: '18px 20px', borderBottom: '1px solid #E2E8F0' }}>
          <div className="section-title">Recent Booking Requests</div>
          <Link to="/owner/bookings" className="view-all-btn">View All →</Link>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', minWidth: 920, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #E2E8F0' }}>
                {['Renter', 'Property', 'Duration', 'Amount', 'Status', 'Actions'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '10px 14px', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bookingRequests.length > 0 ? bookingRequests.slice(0, 5).map((b, i) => {
                const displayAmount = resolveDisplayAmount(b);

                return (
                  <tr key={b.id || i} style={{ borderBottom: '1px solid #F1F5F9' }}>
                    <td style={{ padding: 14 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{
                          width: 36, height: 36, borderRadius: 8,
                          background: 'linear-gradient(135deg,#14B8A6,#2563EB)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          color: '#fff', fontWeight: 600, flexShrink: 0, overflow: 'hidden',
                        }}>
                          {b.renterProfileImage ? (
                            <img src={b.renterProfileImage} alt={b.renterName || 'Renter'} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          ) : (
                            b.renterName?.charAt(0) || 'R'
                          )}
                        </div>
                        <div>
                          <div style={{ fontWeight: 500, fontSize: 14 }}>{b.renterName || 'Renter'}</div>
                          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                            {b.checkInDate ? new Date(b.checkInDate).toLocaleDateString() : '—'}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: 14 }}>
                      <div style={{ fontWeight: 500, fontSize: 14 }}>{b.propertyName || 'Property'}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                        {b.checkOutDate ? `To ${new Date(b.checkOutDate).toLocaleDateString()}` : '—'}
                      </div>
                    </td>

                    {/* Duration */}
                    <td style={{ padding: 14, color: 'var(--text-secondary)', fontSize: 14 }}>
                      {b.durationDisplay
                        || (b.duration && b.durationType ? `${b.duration} ${b.durationType}` : null)
                        || (b.nights != null ? `${b.nights} night${b.nights !== 1 ? 's' : ''}` : 'N/A')}
                    </td>

                    {/* Amount — 1st month + security deposit (matches renter view) */}
                    <td style={{ padding: 14, fontWeight: 600, fontSize: 14 }}>
                      <div>Rs {displayAmount.toLocaleString()}</div>
                      {b.monthlyRent && !b.isDailyRental && (
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 400 }}>
                          Rs {Number(b.monthlyRent).toLocaleString()}/mo
                        </div>
                      )}
                      <div style={{ fontSize: 10, color: 'var(--text-secondary)', fontWeight: 400 }}>
                        1st month + deposit
                      </div>
                    </td>

                    <td style={{ padding: 14 }}>
                      <StatusBadge status={b.status || 'pending'} />
                    </td>
                    <td style={{ padding: 14 }}>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          className="btn btn-sm"
                          style={{ background: 'var(--success)', color: '#fff', fontSize: 12, padding: '5px 12px' }}
                          disabled={actionBusyId === String(b.id || b._id)}
                          onClick={() => handleBookingAction(b, 'accept')}
                        >
                          Approve
                        </button>
                        <button
                          className="btn btn-sm"
                          style={{ background: 'var(--error)', color: '#fff', fontSize: 12, padding: '5px 12px' }}
                          disabled={actionBusyId === String(b.id || b._id)}
                          onClick={() => handleBookingAction(b, 'reject')}
                        >
                          Reject
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              }) : (
                <tr>
                  <td colSpan={6} style={{ padding: '48px 16px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                    <Calendar style={{ margin: '0 auto 12px', color: 'var(--text-muted)' }} size={42} />
                    <p>No booking requests yet</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── My Properties ── */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="section-header" style={{ marginBottom: 0, padding: '18px 20px', borderBottom: '1px solid #E2E8F0' }}>
          <div className="section-title">My Listings</div>
          <Link to="/owner/listings" className="view-all-btn">View All →</Link>
        </div>

        <div
          className="properties-grid"
          style={{
            padding: 20,
            gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
            gap: 16,
          }}
        >
          {properties.length > 0 ? properties.slice(0, 3).map((p, i) => (
            <div
              key={p.id || p._id || i}
              style={{
                border: '1px solid #E2E8F0',
                borderRadius: 12,
                padding: 16,
                display: 'flex',
                flexDirection: 'column',
                minHeight: 190,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                <div style={{ flex: 1 }}>
                  <h3 style={{ fontWeight: 700, fontSize: 15, marginBottom: 4, color: 'var(--text-primary)' }}>
                    {p.title || 'Property Title'}
                  </h3>
                  <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{p.city || p.location?.city || 'Colombo'}</p>
                </div>
                <span style={{
                  background: p.isVerified ? 'var(--success-bg)' : p.verificationStatus === 'rejected' ? '#FEE2E2' : 'var(--warning-bg)',
                  color: p.isVerified ? '#065F46' : p.verificationStatus === 'rejected' ? '#991B1B' : '#92400E',
                  padding: '3px 8px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                }}>
                  {p.isVerified
                    ? 'Verified'
                    : (p.verificationStatus || 'pending').charAt(0).toUpperCase() + (p.verificationStatus || 'pending').slice(1)}
                </span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
                <div>
                  <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 3 }}>Monthly Rent</p>
                  <p style={{ fontWeight: 700, color: 'var(--accent)', fontSize: 16 }}>
                    {formatPrice(p.price)}
                  </p>
                </div>
                <div>
                  <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 3 }}>Views</p>
                  <p style={{ fontWeight: 700, fontSize: 16 }}>{p.views || 0}</p>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 'auto' }}>
                <Link
                  to={`/owner/properties/${p.id || p._id}/edit`}
                  className="btn btn-sm"
                  style={{ flex: 1, background: 'var(--accent)', color: '#fff', fontSize: 13, textAlign: 'center' }}
                >
                  Edit
                </Link>
              </div>
            </div>
          )) : (
            <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '48px 20px' }}>
              <Home style={{ margin: '0 auto 16px', color: 'var(--text-muted)' }} size={48} />
              <p style={{ color: 'var(--text-secondary)', marginBottom: 16 }}>No properties listed yet</p>
              <Link to="/owner/create-listing" className="btn btn-primary">Add New Listing</Link>
            </div>
          )}
        </div>
      </div>
        {/* Confirm modal for reject/cancel actions */}
        {confirmTarget && (
          <ActionConfirmModal
            title={confirmTarget.action === 'reject' ? 'Reject Booking Request?' : 'Cancel Booking?'}
            description={confirmTarget.booking?.propertyName ? `Are you sure you want to ${confirmTarget.action} the booking for "${confirmTarget.booking.propertyName}"?` : `Are you sure you want to ${confirmTarget.action} this booking?`}
            warningNote={confirmTarget.action === 'reject' ? 'The renter will be notified about the rejection.' : 'The renter will be notified about the cancellation.'}
            confirmLabel={confirmTarget.action === 'reject' ? 'Reject' : 'Confirm'}
            confirmColor={confirmTarget.action === 'reject' ? '#EF4444' : '#EF4444'}
            showReason={confirmTarget.action === 'reject' || confirmTarget.action === 'cancel'}
            reason={confirmReason}
            setReason={setConfirmReason}
            busy={actionBusyId === String(confirmTarget.booking?._id || confirmTarget.booking?.id)}
            onClose={() => { if (!actionBusyId) { setConfirmTarget(null); setConfirmReason(''); } }}
            onConfirm={async (r) => {
              await performBookingAction(confirmTarget.booking, confirmTarget.action, r || '');
              setConfirmTarget(null);
              setConfirmReason('');
            }}
          />
        )}
      </OwnerLayout>
  );
}