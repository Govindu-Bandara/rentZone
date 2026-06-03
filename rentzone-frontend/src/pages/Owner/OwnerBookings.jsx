import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import OwnerLayout from '../../components/common/OwnerLayout';
import { bookingAPI } from '../../services/api';
import ActionConfirmModal from '../../components/common/ActionConfirmModal';

const TABS = [
  { key: 'all',       label: 'All' },
  { key: 'pending',   label: 'Pending' },
  { key: 'confirmed', label: 'Confirmed' },
  { key: 'active',    label: 'Active' },
  { key: 'completed', label: 'Completed' },
  { key: 'rejected',  label: 'Rejected' },
  { key: 'cancelled', label: 'Cancelled' },
];

function StatusBadge({ status }) {
  const map = {
    pending:   { bg: '#FFFBEB', color: '#92400E' },
    confirmed: { bg: '#ECFDF5', color: '#065F46' },
    active:    { bg: '#EFF6FF', color: '#1E40AF' },
    completed: { bg: '#F0FDF4', color: '#166534' },
    rejected:  { bg: '#FEF2F2', color: '#991B1B' },
    cancelled: { bg: '#F8FAFC', color: '#475569' },
  };
  const cfg = map[status] || map.pending;
  return (
    <span style={{ background: cfg.bg, color: cfg.color, borderRadius: 20, padding: '4px 10px', fontSize: 12, fontWeight: 600 }}>
      {(status || 'pending').charAt(0).toUpperCase() + (status || 'pending').slice(1)}
    </span>
  );
}

function resolveDuration(booking) {
  if (booking.durationDisplay) return booking.durationDisplay;
  if (booking.isDailyRental) { const n = booking.totalNights || 0; return `${n} night${n !== 1 ? 's' : ''}`; }
  if (booking.duration && booking.durationType) return `${booking.duration} ${booking.durationType}`;
  return 'N/A';
}

function resolveDisplayAmount(booking) {
  if (!booking) return 0;
  const total = Number(booking.totalAmount || 0);
  const monthlyRent = Number(booking.monthlyRent || 0);
  const duration = Number(booking.duration || 0);
  const isDailyRental = Boolean(booking.isDailyRental);
  if (isDailyRental) return total;
  if (monthlyRent > 0 && duration > 0) return monthlyRent + (total - monthlyRent * duration);
  return total;
}

function resolvePaymentStatusDisplay(booking) {
  const raw = String(booking?.paymentStatus || 'pending').toLowerCase();
  // ── NEW: payment_confirmed ────────────────────────────────────────────────
  if (raw === 'payment_confirmed') return { label: 'Confirmed ✅', bg: '#F0FDF4', color: '#166534' };
  if (raw === 'initial_paid' || raw === 'paid') return { label: 'Paid', bg: '#ECFDF5', color: '#065F46' };
  if (raw === 'partial') return { label: 'Partial', bg: '#FFFBEB', color: '#92400E' };
  if (raw === 'failed') return { label: 'Failed', bg: '#FEF2F2', color: '#991B1B' };
  return { label: 'Pending', bg: '#F8FAFC', color: '#475569' };
}

// ── Helper: should "Confirm Payment" button be shown ─────────────────────────
function canConfirmPayment(booking) {
  const paidStatuses = ['paid', 'initial_paid'];
  const actionableStatuses = ['confirmed', 'active'];
  return (
    actionableStatuses.includes(booking.status) &&
    paidStatuses.includes(booking.paymentStatus) &&
    !booking.paymentConfirmedByOwner
  );
}

export default function OwnerBookings() {
  const [bookings,  setBookings ] = useState([]);
  const [loading,   setLoading  ] = useState(true);
  const [activeTab, setActiveTab] = useState('all');
  const [busyId,    setBusyId   ] = useState('');

  const fetchBookings = useCallback(async () => {
    setLoading(true);
    try {
      const params = activeTab === 'all' ? {} : { status: activeTab };
      const res = await bookingAPI.getOwnerBookings(params);
      setBookings(res.data?.bookings || res.data || []);
    } catch {
      toast.error('Failed to load owner bookings');
      setBookings([]);
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  useEffect(() => { fetchBookings(); }, [fetchBookings]);

  const countByTab = useMemo(() => {
    const counts = { all: bookings.length };
    bookings.forEach(b => { const key = b.status || 'pending'; counts[key] = (counts[key] || 0) + 1; });
    return counts;
  }, [bookings]);

  const [confirmTarget, setConfirmTarget] = useState(null);
  const [confirmReason, setConfirmReason] = useState('');

  const performAction = async (booking, action, reason = '') => {
    const bookingId = booking?._id || booking?.id;
    if (!bookingId) return;
    setBusyId(String(bookingId));
    try {
      await bookingAPI.updateOwnerBooking(bookingId, { action, reason });
      toast.success(
        action === 'confirm_payment'
          ? 'Payment confirmed. Renter has been notified.'
          : `Booking ${action}ed successfully`
      );
      await fetchBookings();
    } catch (err) {
      toast.error(err?.error || `Failed to ${action} booking`);
    } finally {
      setBusyId('');
    }
  };

  return (
    <OwnerLayout>
      <div className="dashboard-header" style={{ marginBottom: 12 }}>
        <h1 className="dashboard-title">Booking Requests</h1>
        <p className="dashboard-subtitle">Review, accept, reject, and complete renter booking requests</p>
      </div>

      {confirmTarget && (
        <ActionConfirmModal
          title={confirmTarget.action === 'reject' ? 'Reject Booking Request?' : confirmTarget.action === 'cancel' ? 'Cancel Booking?' : 'Confirm Payment Receipt?'}
          description={
            confirmTarget.action === 'confirm_payment'
              ? `Confirm that you have received the payment for booking ${confirmTarget.booking?.bookingCode || ''}? The renter will be notified.`
              : confirmTarget.booking?.propertyName
                ? `Are you sure you want to ${confirmTarget.action} the booking for "${confirmTarget.booking.propertyName}"?`
                : `Are you sure you want to ${confirmTarget.action} this booking?`
          }
          warningNote={
            confirmTarget.action === 'reject' ? 'The renter will be notified about the rejection.'
            : confirmTarget.action === 'cancel' ? 'The renter will be notified about the cancellation.'
            : 'This action cannot be undone. The renter will be notified.'
          }
          confirmLabel={
            confirmTarget.action === 'reject' ? 'Reject'
            : confirmTarget.action === 'confirm_payment' ? 'Confirm Receipt'
            : 'Confirm'
          }
          confirmColor={confirmTarget.action === 'confirm_payment' ? '#10B981' : '#EF4444'}
          showReason={confirmTarget.action === 'reject' || confirmTarget.action === 'cancel'}
          reason={confirmReason}
          setReason={setConfirmReason}
          busy={busyId === String(confirmTarget.booking?._id || confirmTarget.booking?.id)}
          onClose={() => { if (!busyId) { setConfirmTarget(null); setConfirmReason(''); } }}
          onConfirm={async (r) => {
            await performAction(confirmTarget.booking, confirmTarget.action, r || '');
            setConfirmTarget(null);
            setConfirmReason('');
          }}
        />
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
        {TABS.map(tab => (
          <button
            key={tab.key}
            type="button"
            className={`btn btn-sm ${activeTab === tab.key ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}{(countByTab[tab.key] || 0) > 0 ? ` (${countByTab[tab.key]})` : ''}
          </button>
        ))}
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div className="loading-spinner" style={{ padding: '60px 0' }}><div className="spinner" /></div>
        ) : bookings.length === 0 ? (
          <div style={{ padding: 36, textAlign: 'center', color: 'var(--text-secondary)' }}>No bookings found.</div>
        ) : (
          <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', marginLeft: -20, marginRight: -20, marginBottom: -20, paddingLeft: 20, paddingRight: 20, paddingBottom: 20 }}>
            <table style={{ width: '100%', minWidth: 1060, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #E2E8F0' }}>
                  {['Renter', 'Property', 'Dates', 'Duration', 'Amount', 'Status', 'Payment', 'Actions'].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '12px 14px', fontSize: 13, color: 'var(--text-secondary)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bookings.map(booking => {
                  const id = String(booking?._id || booking?.id || '');
                  const property = booking.property || {};
                  const renter = booking.renter || {};
                  const displayAmount = resolveDisplayAmount(booking);
                  const paymentView = resolvePaymentStatusDisplay(booking);
                  const showConfirmPayment = canConfirmPayment(booking);

                  return (
                    <tr key={id} style={{ borderBottom: '1px solid #F1F5F9' }}>
                      {/* Renter */}
                      <td style={{ padding: 14 }}>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>{renter.name || booking.renterName || 'Renter'}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{renter.email || booking.renterEmail || '—'}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{renter.phone || booking.renterPhone || '—'}</div>
                      </td>

                      {/* Property */}
                      <td style={{ padding: 14 }}>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>{property.title || 'Property'}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{property.city || property.address || '—'}</div>
                      </td>

                      {/* Dates */}
                      <td style={{ padding: 14, fontSize: 13 }}>
                        <div>In:&nbsp;{booking.checkInDate ? new Date(booking.checkInDate).toLocaleDateString() : '—'}</div>
                        <div>Out:&nbsp;{booking.checkOutDate ? new Date(booking.checkOutDate).toLocaleDateString() : '—'}</div>
                      </td>

                      {/* Duration */}
                      <td style={{ padding: 14, fontSize: 13, color: 'var(--text-secondary)' }}>{resolveDuration(booking)}</td>

                      {/* Amount */}
                      <td style={{ padding: 14, fontWeight: 700, fontSize: 14 }}>
                        <div>LKR {displayAmount.toLocaleString()}</div>
                        {booking.monthlyRent && !booking.isDailyRental && (
                          <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 400 }}>LKR {Number(booking.monthlyRent).toLocaleString()}/mo</div>
                        )}
                        <div style={{ fontSize: 10, color: 'var(--text-secondary)', fontWeight: 400 }}>1st month + deposit</div>
                      </td>

                      {/* Status */}
                      <td style={{ padding: 14 }}><StatusBadge status={booking.status} /></td>

                      {/* Payment — shows confirmation date if confirmed ── */}
                      <td style={{ padding: 14, fontSize: 13 }}>
                        <span style={{ background: paymentView.bg, color: paymentView.color, borderRadius: 20, padding: '4px 10px', fontSize: 12, fontWeight: 600 }}>
                          {paymentView.label}
                        </span>
                        {booking.paymentConfirmedAt && (
                          <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 3 }}>
                            {new Date(booking.paymentConfirmedAt).toLocaleDateString()}
                          </div>
                        )}
                      </td>

                      {/* Actions */}
                      <td style={{ padding: 14 }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {booking.status === 'pending' && (
                            <>
                              <button className="btn btn-sm" style={{ background: 'var(--success)', color: '#fff' }} disabled={busyId === id} onClick={() => performAction(booking, 'accept')}>Accept</button>
                              <button className="btn btn-sm" style={{ background: 'var(--error)', color: '#fff' }} disabled={busyId === id} onClick={() => setConfirmTarget({ booking, action: 'reject' })}>Reject</button>
                            </>
                          )}

                          {booking.status === 'confirmed' && (
                            <button className="btn btn-sm" disabled={busyId === id} onClick={() => performAction(booking, 'complete')}>Mark Complete</button>
                          )}

                          {/* ── NEW: Confirm Payment button ───────────────── */}
                          {showConfirmPayment && (
                            <button
                              className="btn btn-sm"
                              style={{ background: '#10B981', color: '#fff', whiteSpace: 'nowrap' }}
                              disabled={busyId === id}
                              onClick={() => setConfirmTarget({ booking, action: 'confirm_payment' })}
                            >
                              ✓ Confirm Payment
                            </button>
                          )}

                          {(booking.status === 'pending' || booking.status === 'confirmed') && (
                            <button className="btn btn-sm btn-ghost" disabled={busyId === id} onClick={() => setConfirmTarget({ booking, action: 'cancel' })}>Cancel</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </OwnerLayout>
  );
}