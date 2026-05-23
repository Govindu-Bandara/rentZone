import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import RenterLayout from '../../components/common/RenterLayout';
import { bookingAPI } from '../../services/api';
import PropertyModal from '../../components/common/PropertyModal';

/* ---- Status config ---- */
const STATUS_CONFIG = {
  payment_completed: {
    label: 'Payment Completed',
    bg: '#ECFDF5',
    color: '#065F46',
    border: 'rgba(16,185,129,0.25)',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    ),
  },
  confirmed: {
    label: 'Booking Confirmed',
    bg: '#ECFDF5',
    color: '#065F46',
    border: 'rgba(16,185,129,0.25)',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    ),
  },
  pending: {
    label: 'Request Sent',
    bg: '#FFFBEB',
    color: '#92400E',
    border: 'rgba(245,158,11,0.25)',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
      </svg>
    ),
  },
  rejected: {
    label: 'Rejected',
    bg: '#FEF2F2',
    color: '#991B1B',
    border: 'rgba(239,68,68,0.25)',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    ),
  },
  active: {
    label: 'Active',
    bg: '#EFF6FF',
    color: '#1E40AF',
    border: 'rgba(59,130,246,0.25)',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="16" /><line x1="8" y1="12" x2="16" y2="12" />
      </svg>
    ),
  },
};

const TAB_OPTIONS = [
  { key: 'all',               label: 'All Bookings' },
  { key: 'active',            label: 'Active' },
  { key: 'confirmed',         label: 'Confirmed' },
  { key: 'pending',           label: 'Pending' },
  { key: 'payment_completed', label: 'Completed' },
  { key: 'rejected',          label: 'Rejected' },
];

/**
 * Compute display amount = 1st month rent + security deposit.
 *
 * Backend stores:
 *   totalAmount = monthlyRent x duration + securityDeposit  (monthly)
 *   totalAmount = nights x dailyRate + securityDeposit      (daily)
 *
 * So:  securityDeposit = totalAmount - monthlyRent x duration
 *      displayAmount   = monthlyRent + securityDeposit
 */
function resolveDisplayAmount(booking) {
  if (!booking) return 0;
  const total         = Number(booking.totalAmount || 0);
  const monthlyRent   = Number(booking.monthlyRent || 0);
  const duration      = Number(booking.duration    || 0);
  const isDailyRental = Boolean(booking.isDailyRental);

  if (isDailyRental) return total;
  if (monthlyRent > 0 && duration > 0) {
    const securityDeposit = total - monthlyRent * duration;
    return monthlyRent + securityDeposit;
  }
  return total;
}

/* ── Cancel Confirmation Modal ──────────────────────────────────────────── */
function CancelConfirmModal({ booking, onConfirm, onClose, busy }) {
  const property = booking?.house || booking?.property || {};

  // Close on backdrop click
  const handleBackdrop = (e) => {
    if (e.target === e.currentTarget && !busy) onClose();
  };

  // Close on Escape key
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, busy]);

  // Lock body scroll while open
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  return (
    <div
      onClick={handleBackdrop}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(2, 6, 23, 0.55)',
        backdropFilter: 'blur(4px)',
        display: 'grid', placeItems: 'center',
        zIndex: 1300, padding: 16,
        animation: 'cancelFadeIn 0.15s ease',
      }}
    >
      <div style={{
        background: '#fff',
        borderRadius: 16,
        width: 'min(420px, 96vw)',
        boxShadow: '0 24px 60px rgba(0,0,0,0.25)',
        overflow: 'hidden',
        animation: 'cancelSlideUp 0.2s cubic-bezier(0.34,1.56,0.64,1)',
      }}>

        {/* Header row */}
        <div style={{ padding: '20px 24px 0', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div style={{
            width: 44, height: 44, borderRadius: 12,
            background: '#FEF2F2', display: 'grid', placeItems: 'center', flexShrink: 0,
          }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="2">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
          </div>
          <button
            onClick={onClose}
            disabled={busy}
            style={{
              background: '#F1F5F9', border: 'none', borderRadius: 8,
              width: 32, height: 32, cursor: busy ? 'not-allowed' : 'pointer',
              display: 'grid', placeItems: 'center', color: '#64748B',
              opacity: busy ? 0.4 : 1, transition: 'opacity 0.15s',
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '14px 24px 0' }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: '#0F172A', marginBottom: 8 }}>
            Cancel Booking Request?
          </h2>
          <p style={{ fontSize: 14, color: '#64748B', lineHeight: 1.65, margin: 0 }}>
            Are you sure you want to cancel your booking request
            {property.title
              ? <> for <strong style={{ color: '#1E293B' }}>"{property.title}"</strong></>
              : ''}?
            {' '}This action cannot be undone.
          </p>
        </div>

        {/* Warning note */}
        <div style={{ margin: '14px 24px 0', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 10, padding: '10px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#D97706" strokeWidth="2"
              style={{ flexShrink: 0, marginTop: 1 }}>
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="12"/>
              <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <p style={{ fontSize: 12, color: '#92400E', margin: 0, lineHeight: 1.55 }}>
              The owner will be notified automatically. You can submit a new booking request at any time.
            </p>
          </div>
        </div>

        {/* Action buttons */}
        <div style={{ padding: '16px 24px 20px', display: 'flex', gap: 10 }}>
          <button
            onClick={onClose}
            disabled={busy}
            style={{
              flex: 1, height: 42, borderRadius: 10,
              border: '1px solid #E2E8F0',
              background: '#F8FAFC', color: '#475569',
              fontSize: 14, fontWeight: 600,
              cursor: busy ? 'not-allowed' : 'pointer',
              opacity: busy ? 0.6 : 1,
              transition: 'all 0.15s',
            }}
          >
            Keep Booking
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            style={{
              flex: 1, height: 42, borderRadius: 10, border: 'none',
              background: busy ? '#FCA5A5' : '#EF4444',
              color: '#fff', fontSize: 14, fontWeight: 600,
              cursor: busy ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              transition: 'background 0.15s',
            }}
          >
            {busy ? (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                  style={{ animation: 'cancelSpin 0.8s linear infinite' }}>
                  <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                </svg>
                Cancelling…
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
                Yes, Cancel Request
              </>
            )}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes cancelFadeIn  { from { opacity: 0 } to { opacity: 1 } }
        @keyframes cancelSlideUp { from { opacity: 0; transform: scale(0.93) translateY(12px) } to { opacity: 1; transform: scale(1) translateY(0) } }
        @keyframes cancelSpin    { to { transform: rotate(360deg) } }
      `}</style>
    </div>
  );
}

/* ── Booking Card ───────────────────────────────────────────────────────── */
function BookingCard({ booking, onRequestCancel, onOpenModal }) {
  const property  = booking.house || booking.property || {};
  const status    = booking.status || 'pending';
  const cfg       = STATUS_CONFIG[status] || STATUS_CONFIG.pending;
  const bookingId = booking._id || booking.id;
  const houseId   = booking.houseId || booking.house?._id || booking.property?._id;
  const canPay    = (status === 'confirmed' || status === 'active') && booking.paymentStatus !== 'paid';
  // Only pending bookings can be cancelled by the renter
  const canCancel = status === 'pending';

  const resolveImage = () => {
    if (property.mainImage) {
      const img = property.mainImage;
      if (typeof img === 'string') return img;
      return img.url || img.publicUrl || '';
    }
    const first = property.images?.[0];
    if (!first) return '';
    if (typeof first === 'string') return first;
    return first.url || first.publicUrl || '';
  };
  const imageSrc = resolveImage() || 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=400&auto=format&fit=crop&q=60';

  const displayAmount = resolveDisplayAmount(booking);
  const amountLabel   = booking.paymentStatus === 'paid' ? 'paid' : 'due today';

  const typeLabel = {
    apartment: 'Apartment', house: 'House',
    boarding: 'Boarding Place', shortStay: 'Short-Stay Rental',
  }[property.propertyType] || property.propertyType;

  const typeColor = {
    apartment: 'badge-blue', house: 'badge-teal',
    boarding: 'badge-amber', shortStay: 'badge-gray',
  }[property.propertyType] || 'badge-blue';

  const formatDate = (d) => d
    ? new Date(d).toLocaleDateString('en-LK', { day: '2-digit', month: 'short', year: 'numeric' })
    : '—';

  return (
    <div className="booking-card" style={{ position: 'relative' }}>
      {/* Status badge in top-right corner of card */}
      <div style={{ position: 'absolute', top: 10, right: 10, zIndex: 10 }}>
        <span
          className="booking-status-badge"
          style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}` }}
        >
          {cfg.icon}
          {cfg.label}
        </span>
      </div>

      {/* Image */}
      <div className="booking-card-image">
        <img src={imageSrc} alt={property.title} loading="lazy" />
        <div className="property-card-badges">
          <span className={`badge ${typeColor}`}>{typeLabel}</span>
          {property.isVerified && <span className="badge badge-verified">Verified</span>}
        </div>
        {property.isFavorite && (
          <div className="booking-card-fav">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="#EF4444" stroke="#EF4444" strokeWidth="2">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
          </div>
        )}
      </div>

      {/* Body */}
      <div className="booking-card-body">
        <div>
          <h3 className="booking-card-title">{property.title || 'Property'}</h3>
          <div className="booking-card-location">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" />
            </svg>
            {property.city || property.location?.city || '—'}, Sri Lanka
          </div>
          <div className="booking-card-meta">
            <span>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 4v16M2 8h18a2 2 0 0 1 2 2v6H2M2 12h20" /></svg>
              {property.bedrooms ?? '—'} Beds
            </span>
            <span>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 12h16a1 1 0 0 1 1 1v3a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4v-3a1 1 0 0 1 1-1zM6 12V5a2 2 0 0 1 2-2h3v2.25" /></svg>
              {property.bathrooms ?? '—'} Baths
            </span>
            {(booking.moveInDate || booking.checkInDate) && (
              <span>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
                Move-in: {formatDate(booking.moveInDate || booking.checkInDate)}
              </span>
            )}
          </div>

          {/* Amount */}
          <div className="booking-card-price">
            LKR {displayAmount.toLocaleString()}
            <span style={{ fontSize: 12, fontWeight: 400, marginLeft: 4 }}>{amountLabel}</span>
          </div>
          <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 0 }}>
            1st month rent + security deposit
          </div>
        </div>

        {/* Status & actions */}
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {houseId && (
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => onOpenModal(houseId, bookingId)}
              >
                View Details
              </button>
            )}
            {canPay && houseId && (
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={() => onOpenModal(houseId, bookingId)}
              >
                Pay Now
              </button>
            )}
            {canCancel && (
              <button
                type="button"
                className="btn btn-sm"
                style={{ color: '#EF4444', borderColor: 'rgba(239,68,68,0.3)' }}
                onClick={() => onRequestCancel(booking)}
              >
                Cancel Request
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Page ───────────────────────────────────────────────────────────────── */
export default function Bookings() {
  const [bookings,     setBookings  ] = useState([]);
  const [loading,      setLoading   ] = useState(true);
  const [error,        setError     ] = useState('');
  const [activeTab,    setActiveTab ] = useState('all');

  // Cancel modal state: holds the full booking object being cancelled
  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancelBusy,   setCancelBusy  ] = useState(false);

  // Property modal state
  const [modalState, setModalState] = useState(null);

  const fetchBookings = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await bookingAPI.getRenterBookings();
      setBookings(res.data?.bookings || res.data || []);
    } catch {
      setError('Failed to load bookings.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchBookings(); }, [fetchBookings]);

  /* Step 1: user clicks "Cancel Request" — open confirmation modal */
  const handleRequestCancel = useCallback((booking) => {
    setCancelTarget(booking);
  }, []);

  /* Step 2: user confirms in modal — call API then close */
  const handleConfirmCancel = useCallback(async () => {
    if (!cancelTarget || cancelBusy) return;
    const bookingId = cancelTarget._id || cancelTarget.id;
    if (!bookingId) return;

    setCancelBusy(true);
    try {
      // PUT /renter/bookings/:id  { action: 'cancel' }
      // Backend (rentzone-renter-bookings) validates:
      //   - booking belongs to this renter (renterId match)
      //   - status is not already 'cancelled' or 'completed'
      // Then sets status = 'cancelled', cancellationReason, cancelledAt
      await bookingAPI.updateRenterBooking(bookingId, { action: 'cancel' });
      toast.success('Booking request cancelled successfully');
      setCancelTarget(null);
      await fetchBookings();
    } catch (err) {
      toast.error(err?.error || err?.message || 'Failed to cancel booking. Please try again.');
    } finally {
      setCancelBusy(false);
    }
  }, [cancelTarget, cancelBusy, fetchBookings]);

  /* Dismiss modal without doing anything */
  const handleDismissCancel = useCallback(() => {
    if (cancelBusy) return;
    setCancelTarget(null);
  }, [cancelBusy]);

  const handleOpenModal = useCallback((propertyId, bookingId) => {
    setModalState({ propertyId, bookingId });
  }, []);

  // Refresh bookings when property modal closes so payment/status changes are reflected
  const handleCloseModal = useCallback(async () => {
    setModalState(null);
    await fetchBookings();
  }, [fetchBookings]);

  const filtered = activeTab === 'all' ? bookings : bookings.filter(b => b.status === activeTab);
  const countFor = (key) => key === 'all' ? bookings.length : bookings.filter(b => b.status === key).length;

  return (
    <RenterLayout>
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Bookings</h1>
          <p className="page-subtitle">
            {loading ? 'Loading…' : `${filtered.length} ${filtered.length === 1 ? 'booking' : 'bookings'}`}
            {activeTab !== 'all' && ` · ${TAB_OPTIONS.find(t => t.key === activeTab)?.label}`}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="bookings-tabs">
        {TAB_OPTIONS.map(tab => {
          const count = countFor(tab.key);
          return (
            <button
              key={tab.key}
              className={`bookings-tab${activeTab === tab.key ? ' active' : ''}`}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
              {count > 0 && <span className="tab-count">{count}</span>}
            </button>
          );
        })}
      </div>

      {/* Content */}
      {loading ? (
        <div className="loading-spinner" style={{ paddingTop: 60 }}><div className="spinner" /></div>
      ) : error ? (
        <div className="alert alert-error" style={{ marginTop: 24 }}>{error}</div>
      ) : filtered.length === 0 ? (
        <div className="empty-state" style={{ paddingTop: 80 }}>
          <div className="empty-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
            </svg>
          </div>
          <div className="empty-title">No bookings found</div>
          <div className="empty-desc">
            {activeTab === 'all'
              ? 'You have not made any booking requests yet.'
              : `No ${TAB_OPTIONS.find(t => t.key === activeTab)?.label.toLowerCase()} bookings.`}
          </div>
          <Link to="/renter/search" className="btn btn-primary btn-sm" style={{ marginTop: 16 }}>
            Browse Properties
          </Link>
        </div>
      ) : (
        <div className="bookings-list">
          {filtered.map(b => (
            <div
              key={b._id || b.id}
              style={{
                opacity: cancelBusy && String(cancelTarget?._id || cancelTarget?.id) === String(b._id || b.id) ? 0.5 : 1,
                transition: 'opacity 0.2s',
              }}
            >
              <BookingCard
                booking={b}
                onRequestCancel={handleRequestCancel}
                onOpenModal={handleOpenModal}
              />
            </div>
          ))}
        </div>
      )}

      {/* ── Cancel confirmation popup ── */}
      {cancelTarget && (
        <CancelConfirmModal
          booking={cancelTarget}
          onConfirm={handleConfirmCancel}
          onClose={handleDismissCancel}
          busy={cancelBusy}
        />
      )}

      {/* ── Property detail / payment modal ── */}
      {modalState && (
        <PropertyModal
          propertyId={modalState.propertyId}
          initialBookingId={modalState.bookingId}
          onClose={handleCloseModal}
        />
      )}
    </RenterLayout>
  );
}