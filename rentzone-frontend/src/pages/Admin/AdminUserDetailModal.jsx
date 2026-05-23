import { useState, useEffect } from 'react';
import { adminAPI } from '../../services/api';
import {
  X, User, Mail, Phone, Shield, CheckCircle, XCircle,
  Clock, CreditCard, Building, Eye, AlertTriangle, Lock, Unlock
} from 'lucide-react';

function InfoRow({ label, value, icon, badge }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 0', borderBottom: '1px solid #F1F5F9' }}>
      <span style={{ color: '#94A3B8', flexShrink: 0, marginTop: 1 }}>{icon}</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 2 }}>
          {label}
        </div>
        {badge ? badge : (
          <div style={{ fontSize: 14, color: '#1E293B', fontWeight: 500 }}>{value || '—'}</div>
        )}
      </div>
    </div>
  );
}

function NICImage({ label, src }) {
  const [expanded, setExpanded] = useState(false);
  if (!src) {
    return (
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#64748B', marginBottom: 6 }}>{label}</div>
        <div style={{
          background: '#F1F5F9', border: '2px dashed #CBD5E1', borderRadius: 10,
          height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexDirection: 'column', gap: 6
        }}>
          <AlertTriangle size={20} style={{ color: '#CBD5E1' }} />
          <span style={{ fontSize: 12, color: '#94A3B8' }}>Not uploaded</span>
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#64748B', marginBottom: 6 }}>{label}</div>
      <div
        style={{ position: 'relative', borderRadius: 10, overflow: 'hidden', cursor: 'pointer', border: '2px solid #E2E8F0' }}
        onClick={() => setExpanded(true)}
      >
        <img src={src} alt={label} style={{ width: '100%', height: 120, objectFit: 'cover', display: 'block' }} />
        <div style={{
          position: 'absolute', inset: 0, background: 'rgba(0,0,0,0)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'background 0.2s',
        }}
          onMouseEnter={e => e.currentTarget.style.background = 'rgba(0,0,0,0.3)'}
          onMouseLeave={e => e.currentTarget.style.background = 'rgba(0,0,0,0)'}
        >
          <Eye size={20} style={{ color: 'white', opacity: 0, transition: 'opacity 0.2s' }}
            onMouseEnter={e => e.currentTarget.style.opacity = '1'} />
        </div>
        <div style={{ position: 'absolute', bottom: 6, right: 6, background: 'rgba(0,0,0,0.5)', borderRadius: 4, padding: '2px 6px' }}>
          <Eye size={12} style={{ color: 'white' }} />
        </div>
      </div>

      {expanded && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
            zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 20
          }}
          onClick={() => setExpanded(false)}
        >
          <img src={src} alt={label} style={{ maxWidth: '90vw', maxHeight: '85vh', objectFit: 'contain', borderRadius: 8 }} />
          <button
            onClick={() => setExpanded(false)}
            style={{
              position: 'absolute', top: 20, right: 20,
              background: 'rgba(255,255,255,0.15)', border: 'none',
              borderRadius: '50%', width: 40, height: 40,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', color: 'white'
            }}
          >
            <X size={20} />
          </button>
          <div style={{
            position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)',
            background: 'rgba(255,255,255,0.1)', backdropFilter: 'blur(8px)',
            borderRadius: 8, padding: '8px 16px', color: 'white', fontSize: 13
          }}>
            {label} · Click anywhere to close
          </div>
        </div>
      )}
    </div>
  );
}

// Derive initials from whatever name fields are available
function getInitials(u) {
  if (!u) return 'U';
  const first = u.firstName?.[0] || u.name?.split(' ')?.[0]?.[0] || '';
  const last  = u.lastName?.[0]  || u.name?.split(' ')?.[1]?.[0] || '';
  return (first + last).toUpperCase() || 'U';
}

export default function AdminUserDetailModal({ user, onClose, onActionComplete }) {
  const [actionBusy,     setActionBusy    ] = useState('');
  const [confirmAction,  setConfirmAction ] = useState(null);
  const [reason,         setReason        ] = useState('');
  const [successMsg,     setSuccessMsg    ] = useState('');
  const [fullUser,       setFullUser      ] = useState(null);
  const [loading,        setLoading       ] = useState(false);

  useEffect(() => {
    if (!user?._id) return;

    // Always fetch the full user document so every field is populated:
    // role, createdAt, profileImage, nicDetails, properties, bookings, etc.
    setLoading(true);
    setFullUser(null);

    adminAPI.getUserDetail(user._id)
      .then(response => {
        setFullUser(response.data.user || response.data);
      })
      .catch(err => {
        console.error('Failed to fetch full user data:', err);
        // Best-effort fallback: normalise name fields and preserve role hint
        const rawName = user.name || `${user.firstName || ''} ${user.lastName || ''}`.trim();
        const [first = '', ...rest] = rawName.split(' ');
        setFullUser({
          ...user,
          firstName: user.firstName || first,
          lastName:  user.lastName  || rest.join(' '),
          role:      user.role      || 'owner',
        });
      })
      .finally(() => setLoading(false));
  }, [user?._id]);

  if (!user) return null;

  // ── Loading state ── show a spinner that already has the correct name/photo
  // using whatever the caller passed in (avoids the "KP / Inactive" flash).
  if (loading || !fullUser) {
    const initials     = getInitials(user);
    const profileImage = user.profileImage || null;
    const displayName  = user.name
      || `${user.firstName || ''} ${user.lastName || ''}`.trim()
      || '…';

    return (
      <>
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(2,6,23,0.6)', backdropFilter: 'blur(4px)', zIndex: 1400 }} onClick={onClose} />
        <div style={{
          position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
          background: '#fff', borderRadius: 20, zIndex: 1500,
          boxShadow: '0 24px 60px rgba(0,0,0,0.3)', overflow: 'hidden',
          width: 'min(720px, 96vw)',
        }}>
          {/* Header skeleton — uses real photo/initials immediately */}
          <div style={{
            background: 'linear-gradient(135deg,#1E293B 0%,#334155 100%)',
            padding: '24px 28px',
            display: 'flex', alignItems: 'center', gap: 16
          }}>
            <div style={{
              width: 60, height: 60, borderRadius: '50%',
              background: 'linear-gradient(135deg,#14B8A6,#2563EB)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', fontWeight: 700, fontSize: 22, flexShrink: 0, overflow: 'hidden',
              border: '3px solid rgba(255,255,255,0.2)'
            }}>
              {profileImage
                ? <img src={profileImage} alt={displayName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => { e.currentTarget.style.display = 'none'; }} />
                : initials
              }
            </div>
            <div style={{ flex: 1 }}>
              <h2 style={{ color: 'white', fontSize: 20, fontWeight: 700, margin: 0 }}>{displayName}</h2>
              {user.role && (
                <span style={{ background: 'rgba(255,255,255,0.15)', color: 'white', fontSize: 11, fontWeight: 600, borderRadius: 12, padding: '2px 10px', textTransform: 'capitalize', display: 'inline-block', marginTop: 6 }}>
                  {user.role}
                </span>
              )}
            </div>
            <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: 8, width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'white' }}>
              <X size={18} />
            </button>
          </div>
          {/* Spinner body */}
          <div style={{ padding: 40, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 36, height: 36, border: '3px solid #E2E8F0',
              borderTopColor: '#2563EB', borderRadius: '50%',
              animation: 'spin 0.8s linear infinite'
            }} />
            <div style={{ fontSize: 14, color: '#64748B' }}>Loading user details…</div>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        </div>
      </>
    );
  }

  // ── Fully loaded ────────────────────────────────────────────────────────
  const displayUser = fullUser;
  const initials    = getInitials(displayUser);

  const statusBadge = displayUser.isSuspended
    ? { bg: '#FEE2E2', color: '#991B1B', label: 'Suspended' }
    : displayUser.isActive
      ? { bg: '#ECFDF5', color: '#065F46', label: 'Active' }
      : { bg: '#F3F4F6', color: '#6B7280', label: 'Inactive' };

  const verificationBadge = displayUser.isVerified
    ? { bg: '#EFF6FF', color: '#1E40AF', label: '✓ Email Verified' }
    : { bg: '#FEF3C7', color: '#92400E', label: '⏳ Email Pending' };

  const identityBadge = displayUser.isAdminVerified
    ? { bg: '#ECFDF5', color: '#065F46', label: '✓ Identity Verified' }
    : { bg: '#FEF3C7', color: '#92400E', label: '⏳ Identity Pending' };

  const handleAction = async (action, extraReason = '') => {
    setActionBusy(action);
    setSuccessMsg('');
    try {
      await adminAPI.updateUser(displayUser._id, { action, reason: extraReason || reason });
      const messages = {
        suspend:          'User suspended successfully.',
        activate:         'User activated successfully.',
        verify:           'Email verified successfully.',
        verify_identity:  'Identity verified successfully.',
      };
      setSuccessMsg(messages[action] || 'Action completed.');
      setConfirmAction(null);
      setReason('');
      if (onActionComplete) onActionComplete(displayUser._id, action);
    } catch (err) {
      console.error(`Action ${action} failed:`, err);
    } finally {
      setActionBusy('');
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div
        style={{ position: 'fixed', inset: 0, background: 'rgba(2,6,23,0.6)', backdropFilter: 'blur(4px)', zIndex: 1400 }}
        onClick={onClose}
      />

      {/* Modal */}
      <div style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
        width: 'min(720px, 96vw)', maxHeight: '90vh', overflowY: 'auto',
        background: '#fff', borderRadius: 20, zIndex: 1500,
        boxShadow: '0 24px 60px rgba(0,0,0,0.3)',
      }}>
        {/* ── Header ── */}
        <div style={{
          background: 'linear-gradient(135deg,#1E293B 0%,#334155 100%)',
          padding: '24px 28px', borderRadius: '20px 20px 0 0',
          display: 'flex', alignItems: 'center', gap: 16
        }}>
          <div style={{
            width: 60, height: 60, borderRadius: '50%',
            background: 'linear-gradient(135deg,#14B8A6,#2563EB)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontWeight: 700, fontSize: 22, flexShrink: 0, overflow: 'hidden',
            border: '3px solid rgba(255,255,255,0.2)'
          }}>
            {displayUser.profileImage
              ? <img
                  src={displayUser.profileImage}
                  alt={initials}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  onError={e => { e.currentTarget.style.display = 'none'; }}
                />
              : initials
            }
          </div>

          <div style={{ flex: 1 }}>
            <h2 style={{ color: 'white', fontSize: 20, fontWeight: 700, margin: 0 }}>
              {displayUser.firstName} {displayUser.lastName}
            </h2>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
              {displayUser.role && (
                <span style={{ background: 'rgba(255,255,255,0.15)', color: 'white', fontSize: 11, fontWeight: 600, borderRadius: 12, padding: '2px 10px', textTransform: 'capitalize' }}>
                  {displayUser.role}
                </span>
              )}
              <span style={{ background: statusBadge.bg, color: statusBadge.color, fontSize: 11, fontWeight: 600, borderRadius: 12, padding: '2px 10px' }}>
                {statusBadge.label}
              </span>
              {displayUser.isVerified && (
                <span style={{ background: '#ECFDF5', color: '#065F46', fontSize: 11, fontWeight: 600, borderRadius: 12, padding: '2px 10px' }}>
                  ✓ Verified
                </span>
              )}
            </div>
          </div>

          <button
            onClick={onClose}
            style={{ background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: 8, width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'white' }}
          >
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: 28 }}>
          {successMsg && (
            <div style={{ background: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: 10, padding: '10px 14px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 8, color: '#065F46', fontSize: 14, fontWeight: 500 }}>
              <CheckCircle size={16} /> {successMsg}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: displayUser.role === 'owner' ? '1fr 1fr' : '1fr', gap: 24 }}>
            {/* ── Left Column ── */}
            <div>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: '#1E293B', marginBottom: 4, paddingBottom: 10, borderBottom: '2px solid #F1F5F9' }}>
                Personal Information
              </h3>
              <InfoRow label="Email"       value={displayUser.email}  icon={<Mail  size={14} />} />
              <InfoRow label="Phone"       value={displayUser.phone}  icon={<Phone size={14} />} />
              <InfoRow
                label="Member Since"
                value={displayUser.createdAt ? new Date(displayUser.createdAt).toLocaleDateString('en-LK', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'}
                icon={<Clock size={14} />}
              />
              <InfoRow
                label="Last Login"
                value={displayUser.lastLogin ? new Date(displayUser.lastLogin).toLocaleString('en-LK') : 'Never'}
                icon={<Clock size={14} />}
              />

              <h3 style={{ fontSize: 14, fontWeight: 700, color: '#1E293B', margin: '20px 0 4px', paddingBottom: 10, borderBottom: '2px solid #F1F5F9' }}>
                Account Status
              </h3>
              <InfoRow label="Email Verification" icon={<Mail size={14} />} badge={
                <span style={{ background: verificationBadge.bg, color: verificationBadge.color, fontSize: 12, fontWeight: 600, borderRadius: 12, padding: '3px 10px', display: 'inline-block' }}>
                  {verificationBadge.label}
                </span>
              } />
              {displayUser.role === 'owner' && (
                <InfoRow label="Identity Verification" icon={<Shield size={14} />} badge={
                  <span style={{ background: identityBadge.bg, color: identityBadge.color, fontSize: 12, fontWeight: 600, borderRadius: 12, padding: '3px 10px', display: 'inline-block' }}>
                    {identityBadge.label}
                  </span>
                } />
              )}
              <InfoRow label="Properties" value={displayUser.properties || 0} icon={<Building   size={14} />} />
              <InfoRow label="Bookings"   value={displayUser.bookings   || 0} icon={<CreditCard size={14} />} />

              {displayUser.role === 'owner' && displayUser.bankDetails && (
                <>
                  <h3 style={{ fontSize: 14, fontWeight: 700, color: '#1E293B', margin: '20px 0 4px', paddingBottom: 10, borderBottom: '2px solid #F1F5F9' }}>
                    Bank Details
                  </h3>
                  <InfoRow label="Bank Name"        value={displayUser.bankDetails.bankName}            icon={<Building  size={14} />} />
                  <InfoRow label="Branch"           value={displayUser.bankDetails.branchName}          icon={<Building  size={14} />} />
                  <InfoRow label="Account Holder"   value={displayUser.bankDetails.accountHolderName}   icon={<User      size={14} />} />
                  <InfoRow label="Account Number"   value={`****${displayUser.bankDetails.bankAccountNumber?.slice(-4)}`} icon={<CreditCard size={14} />} />
                </>
              )}
            </div>

            {/* ── Right Column: NIC (owner only) ── */}
            {displayUser.role === 'owner' && (
              <div>
                <h3 style={{ fontSize: 14, fontWeight: 700, color: '#1E293B', marginBottom: 4, paddingBottom: 10, borderBottom: '2px solid #F1F5F9' }}>
                  Identity Documents (NIC)
                </h3>
                <p style={{ fontSize: 12, color: '#64748B', marginBottom: 14, lineHeight: 1.5 }}>
                  Review the NIC images below to verify this owner's identity. Click any image to enlarge.
                </p>

                <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
                  <NICImage label="NIC Front" src={displayUser.nicDetails?.frontImageUrl} />
                  <NICImage label="NIC Back"  src={displayUser.nicDetails?.backImageUrl}  />
                </div>

                {displayUser.nicDetails?.verifiedAt ? (
                  <div style={{ background: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#065F46' }}>
                    ✓ Identity verified by {displayUser.nicDetails.verifiedBy} on {new Date(displayUser.nicDetails.verifiedAt).toLocaleDateString()}
                  </div>
                ) : displayUser.nicDetails?.frontImageUrl && displayUser.nicDetails?.backImageUrl ? (
                  <div style={{ background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#92400E' }}>
                    ⏳ NIC images uploaded — awaiting admin review
                  </div>
                ) : (
                  <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#991B1B' }}>
                    ⚠️ NIC images not yet uploaded
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Actions ── */}
          <div style={{ marginTop: 28, paddingTop: 20, borderTop: '2px solid #F1F5F9' }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: '#1E293B', marginBottom: 14 }}>Admin Actions</h3>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>

              {!displayUser.isVerified && (
                <button
                  onClick={() => handleAction('verify')}
                  disabled={!!actionBusy}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 8, border: 'none', background: '#EFF6FF', color: '#1E40AF', fontSize: 13, fontWeight: 600, cursor: actionBusy ? 'not-allowed' : 'pointer', opacity: actionBusy ? 0.7 : 1 }}
                >
                  <CheckCircle size={14} /> {actionBusy === 'verify' ? 'Verifying…' : 'Verify Email'}
                </button>
              )}

              {displayUser.role === 'owner' && !displayUser.isAdminVerified && (
                <button
                  onClick={() => handleAction('verify_identity')}
                  disabled={!!actionBusy}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 8, border: 'none', background: '#ECFDF5', color: '#065F46', fontSize: 13, fontWeight: 600, cursor: actionBusy ? 'not-allowed' : 'pointer', opacity: actionBusy ? 0.7 : 1 }}
                >
                  <Shield size={14} /> {actionBusy === 'verify_identity' ? 'Verifying…' : 'Verify Identity (NIC)'}
                </button>
              )}

              {!displayUser.isSuspended ? (
                <button
                  onClick={() => setConfirmAction('suspend')}
                  disabled={!!actionBusy}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 8, border: 'none', background: '#FEE2E2', color: '#991B1B', fontSize: 13, fontWeight: 600, cursor: actionBusy ? 'not-allowed' : 'pointer', opacity: actionBusy ? 0.7 : 1 }}
                >
                  <Lock size={14} /> Suspend User
                </button>
              ) : (
                <button
                  onClick={() => handleAction('activate')}
                  disabled={!!actionBusy}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 8, border: 'none', background: '#ECFDF5', color: '#065F46', fontSize: 13, fontWeight: 600, cursor: actionBusy ? 'not-allowed' : 'pointer', opacity: actionBusy ? 0.7 : 1 }}
                >
                  <Unlock size={14} /> {actionBusy === 'activate' ? 'Activating…' : 'Activate User'}
                </button>
              )}
            </div>

            {confirmAction === 'suspend' && (
              <div style={{ marginTop: 16, background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10, padding: 16 }}>
                <p style={{ fontSize: 14, color: '#7F1D1D', fontWeight: 600, marginBottom: 8 }}>
                  Confirm Suspension
                </p>
                <textarea
                  placeholder="Reason for suspension (optional)"
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  style={{ width: '100%', padding: 8, border: '1px solid #FECACA', borderRadius: 6, fontSize: 13, resize: 'none', height: 60, fontFamily: 'inherit', marginBottom: 10, boxSizing: 'border-box' }}
                />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => { setConfirmAction(null); setReason(''); }}
                    style={{ flex: 1, padding: '8px', borderRadius: 8, border: '1px solid #E2E8F0', background: '#fff', color: '#475569', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                    Cancel
                  </button>
                  <button onClick={() => handleAction('suspend', reason)} disabled={actionBusy === 'suspend'}
                    style={{ flex: 1, padding: '8px', borderRadius: 8, border: 'none', background: '#EF4444', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                    {actionBusy === 'suspend' ? 'Suspending…' : 'Confirm Suspend'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}