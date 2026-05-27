import { useEffect, useState } from 'react';

export default function ActionConfirmModal({
  title = 'Confirm',
  description = '',
  warningNote = null,
  confirmLabel = 'Confirm',
  confirmColor = '#EF4444',
  showReason = false,
  reason, setReason,
  onConfirm, onClose, busy = false,
}) {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.innerWidth <= 640
  );

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, busy]);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 640);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(2,6,23,0.55)', display: 'grid', placeItems: 'center', zIndex: 1300, padding: isMobile ? 10 : 16 }}
    >
      <div style={{ background: '#fff', borderRadius: isMobile ? 12 : 16, width: isMobile ? '100%' : 'min(520px,96vw)', maxHeight: '92vh', boxShadow: '0 24px 60px rgba(0,0,0,0.25)', overflow: 'auto' }}>
        <div style={{ padding: isMobile ? '16px 14px 0' : '20px 24px 0', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: '#FEF2F2', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            </div>
            <div>
              <h2 style={{ fontSize: isMobile ? 16 : 18, fontWeight: 700, color: '#0F172A', margin: 0 }}>{title}</h2>
              {description ? <p style={{ marginTop: 8, fontSize: 14, color: '#64748B' }}>{description}</p> : null}
            </div>
          </div>
          <button onClick={onClose} disabled={busy} style={{ background: '#F1F5F9', border: 'none', borderRadius: 8, width: 32, height: 32, display: 'grid', placeItems: 'center', color: '#64748B' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div style={{ padding: isMobile ? '12px 14px 0' : '14px 24px 0' }}>
          {warningNote ? (
            <div style={{ marginBottom: 12, background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 10, padding: '10px 14px' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#D97706" strokeWidth="2" style={{ flexShrink: 0, marginTop: 1 }}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                <div style={{ fontSize: 13, color: '#92400E' }}>{warningNote}</div>
              </div>
            </div>
          ) : null}

          {showReason && (
            <div style={{ marginTop: 8 }}>
              <label style={{ display: 'block', fontSize: 13, color: '#475569', marginBottom: 6 }}>Reason (optional)</label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Add a reason for the renter (optional)"
                rows={isMobile ? 3 : 4}
                style={{ width: '100%', borderRadius: 8, border: '1px solid #E6EEF3', padding: 10, fontSize: 13 }}
                disabled={busy}
              />
            </div>
          )}
        </div>

        <div style={{ padding: isMobile ? '14px 14px 16px' : '16px 24px 20px', display: 'flex', gap: 10, flexDirection: isMobile ? 'column-reverse' : 'row' }}>
          <button onClick={onClose} disabled={busy} style={{ flex: 1, height: 42, borderRadius: 10, border: '1px solid #E2E8F0', background: '#F8FAFC', color: '#475569', fontSize: 14, fontWeight: 600 }}>Keep</button>
          <button
            onClick={() => onConfirm(reason)}
            disabled={busy}
            style={{ flex: 1, height: 42, borderRadius: 10, border: 'none', background: busy ? '#FCA5A5' : confirmColor, color: '#fff', fontSize: 14, fontWeight: 600 }}
          >
            {busy ? 'Processing…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
