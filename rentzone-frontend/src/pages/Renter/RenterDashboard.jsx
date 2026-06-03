import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { renterAPI, favoriteAPI } from '../../services/api';
import RenterLayout from '../../components/common/RenterLayout';
import PropertyModal from '../../components/common/PropertyModal';

/* ─────────────────────────────────────────────
   PROPERTY CARD
───────────────────────────────────────────── */
function PropertyCard({ property, onOpenModal }) {
  const [faved, setFaved] = useState(property.isFavorite || property.isSaved || false);
  const [favLoading, setFavLoading] = useState(false);
  const [imageIndex, setImageIndex] = useState(0);
  const [orderedImages, setOrderedImages] = useState([]);

  const images = property.images || [];
  const hasMultipleImages = images.length > 1;

  // Rearrange images to show mainImage first if available
  useEffect(() => {
    if (property.mainImage && images.length > 0) {
      const mainImageUrl = typeof property.mainImage === 'string' ? property.mainImage : property.mainImage.url;
      const mainImageExists = images.findIndex(img => {
        const imgUrl = typeof img === 'string' ? img : img.url;
        return imgUrl === mainImageUrl;
      });
      if (mainImageExists > 0) {
        const reordered = [images[mainImageExists], ...images.slice(0, mainImageExists), ...images.slice(mainImageExists + 1)];
        setOrderedImages(reordered);
        setImageIndex(0);
      } else if (mainImageExists === 0) {
        setOrderedImages(images);
        setImageIndex(0);
      } else {
        setOrderedImages(images);
      }
    } else {
      setOrderedImages(images);
    }
  }, [property.mainImage, property._id, images]);

  // Auto-rotate images every 3 seconds if there are multiple
  useEffect(() => {
    if (!hasMultipleImages) return;
    const interval = setInterval(() => {
      setImageIndex(prev => (prev + 1) % orderedImages.length);
    }, 3000);
    return () => clearInterval(interval);
  }, [hasMultipleImages, orderedImages.length]);

  const typeLabel = {
    apartment: 'Apartment', house: 'House',
    boarding: 'Boarding Place', shortStay: 'Short-Stay Rental',
  }[property.propertyType] || property.propertyType;

  const typeColor = {
    apartment: 'badge-blue', house: 'badge-teal',
    boarding: 'badge-amber', shortStay: 'badge-gray',
  }[property.propertyType] || 'badge-blue';

  const priceAmount = property.price?.amount ?? property.price ?? 0;
  const priceUnit   = property.rentalType === 'short_stay' ? '/day' : '/mo';
  const city        = property.location?.city || '';
  const district    = property.location?.district || '';
  const bedrooms    = property.propertyDetails?.bedrooms ?? property.bedrooms;
  const bathrooms   = property.propertyDetails?.bathrooms ?? property.bathrooms;
  const imgSrc      = orderedImages[imageIndex]?.url || orderedImages[imageIndex]
    || 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=400&auto=format&fit=crop&q=60';

  return (
    <div
      className="property-card"
      style={{ cursor: 'pointer' }}
      onClick={() => onOpenModal(property._id)}
    >
      <div className="property-card-image">
          <img src={imgSrc} alt={property.title} loading="lazy" />
        <div className="property-card-badges">
          <span className={`badge ${typeColor}`}>{typeLabel}</span>
          {property.isVerified && <span className="badge badge-verified">✓ Verified</span>}
        </div>

        {/* Image dot indicators */}
        {hasMultipleImages && (
          <div style={{
            position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)',
            display: 'flex', gap: 4, zIndex: 10,
          }}>
            {orderedImages.map((_, idx) => (
              <div key={idx} style={{
                width: idx === imageIndex ? 8 : 6, height: 6, borderRadius: '50%',
                background: idx === imageIndex ? '#fff' : 'rgba(255,255,255,0.6)',
                transition: 'all 0.3s ease',
                boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
              }} />
            ))}
          </div>
        )}

        <button
          className={`property-card-fav${faved ? ' active' : ''}`}
          onClick={async (e) => {
            e.stopPropagation();
            setFavLoading(true);
            try {
              if (faved) {
                await favoriteAPI.removeFavorite(property._id);
              } else {
                await favoriteAPI.addFavorite(property._id);
              }
              setFaved(v => !v);
            } catch (error) {
              console.error('Error toggling favorite:', error);
            } finally {
              setFavLoading(false);
            }
          }}
          disabled={favLoading}
          aria-label="Toggle favourite"
        >
          {favLoading ? (
            <div className="spinner spinner-sm" style={{ width: 12, height: 12, borderWidth: 2 }} />
          ) : (
            <svg width="15" height="15" viewBox="0 0 24 24"
              fill={faved ? '#EF4444' : 'none'}
              stroke={faved ? '#EF4444' : 'currentColor'} strokeWidth="2">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
          )}
        </button>
      </div>

      <div className="property-card-body">
        <div className="property-card-title">{property.title}</div>
        {city && (
          <div className="property-card-location">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
            </svg>
            {city}{district ? `, ${district}` : ''}, Sri Lanka
          </div>
        )}
        <div className="property-card-meta">
          {bedrooms !== undefined && (
            <span>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M2 4v16M2 8h18a2 2 0 0 1 2 2v6H2M2 12h20"/>
              </svg>
              {bedrooms} Beds
            </span>
          )}
          {bathrooms !== undefined && (
            <span>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 12h16a1 1 0 0 1 1 1v3a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4v-3a1 1 0 0 1 1-1zM6 12V5a2 2 0 0 1 2-2h3v2.25"/>
              </svg>
              {bathrooms} Baths
            </span>
          )}
        </div>
        <div className="property-card-price">
          LKR {Number(priceAmount).toLocaleString()}<span>{priceUnit}</span>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   SKELETON CARD
───────────────────────────────────────────── */
function SkeletonCard() {
  return (
    <div className="property-card" style={{ pointerEvents: 'none' }}>
      <div className="property-card-image" style={{
        background: 'linear-gradient(90deg,#F1F5F9 25%,#E2E8F0 50%,#F1F5F9 75%)',
        backgroundSize: '200% 100%',
        animation: 'shimmer 1.4s infinite',
      }} />
      <div className="property-card-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ height: 14, borderRadius: 6, background: '#F1F5F9', width: '80%' }} />
        <div style={{ height: 12, borderRadius: 6, background: '#F1F5F9', width: '60%' }} />
        <div style={{ height: 12, borderRadius: 6, background: '#F1F5F9', width: '50%' }} />
        <div style={{ height: 18, borderRadius: 6, background: '#F1F5F9', width: '45%' }} />
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   SLIDER — shows 3 cards at a time
───────────────────────────────────────────── */
const CARDS_PER_PAGE = 3;

function Slider({ items, loading, skeletonCount = 3, renderItem, emptyState }) {
  const [index, setIndex] = useState(0);

  useEffect(() => { setIndex(0); }, [items.length]);

  const maxIndex = Math.max(0, items.length - CARDS_PER_PAGE);
  const canPrev  = index > 0;
  const canNext  = index < maxIndex;

  const ArrowBtn = ({ onClick, disabled, children }) => (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
        border: '1.5px solid',
        borderColor: disabled ? '#E2E8F0' : 'var(--primary)',
        background: disabled ? '#F8FAFC' : 'white',
        color: disabled ? '#CBD5E1' : 'var(--primary)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'all 0.2s',
        boxShadow: disabled ? 'none' : '0 2px 8px rgba(37,99,235,0.15)',
      }}
      onMouseEnter={e => { if (!disabled) { e.currentTarget.style.background = 'var(--primary)'; e.currentTarget.style.color = 'white'; }}}
      onMouseLeave={e => { e.currentTarget.style.background = disabled ? '#F8FAFC' : 'white'; e.currentTarget.style.color = disabled ? '#CBD5E1' : 'var(--primary)'; }}
    >
      {children}
    </button>
  );

  if (loading) {
    return (
      <div className="properties-grid">
        {Array.from({ length: skeletonCount }).map((_, i) => <SkeletonCard key={i} />)}
      </div>
    );
  }

  if (!items || items.length === 0) return emptyState;

  const visible = items.slice(index, index + CARDS_PER_PAGE);

  return (
    <div>
      <div className="properties-grid" style={{ marginBottom: 16 }}>
        {visible.map(item => renderItem(item))}
      </div>

      {items.length > CARDS_PER_PAGE && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 4 }}>
          <div style={{ display: 'flex', gap: 6 }}>
            {Array.from({ length: maxIndex + 1 }).map((_, i) => (
              <button key={i} onClick={() => setIndex(i)} style={{
                width: i === index ? 20 : 8, height: 8, borderRadius: 4,
                border: 'none', cursor: 'pointer', padding: 0,
                background: i === index ? 'var(--primary)' : '#CBD5E1',
                transition: 'all 0.25s',
              }} />
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              {index + 1} – {Math.min(index + CARDS_PER_PAGE, items.length)} of {items.length}
            </span>
            <ArrowBtn onClick={() => setIndex(i => Math.max(0, i - 1))} disabled={!canPrev}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>
            </ArrowBtn>
            <ArrowBtn onClick={() => setIndex(i => Math.min(maxIndex, i + 1))} disabled={!canNext}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="9 18 15 12 9 6"/></svg>
            </ArrowBtn>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────
   EMPTY STATE
───────────────────────────────────────────── */
function EmptyState({ emoji, title, desc, to, btnLabel }) {
  return (
    <div
      className="card"
      style={{
        padding: '40px 24px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        minHeight: 220,
      }}
    >
      <div style={{ fontSize: 36, marginBottom: 12 }}>{emoji}</div>

      <div className="empty-title" style={{ marginBottom: 6 }}>
        {title}
      </div>

      <div
        className="empty-desc"
        style={{
          marginBottom: 20,
          maxWidth: 320,
        }}
      >
        {desc}
      </div>

      {to && (
        <Link to={to} className="btn btn-primary btn-sm">
          {btnLabel}
        </Link>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────
   MAIN DASHBOARD
───────────────────────────────────────────── */
export default function RenterDashboard() {
  const { user } = useAuth();

  const [stats,           setStats         ] = useState(null);
  const [statsLoading,    setStatsLoading  ] = useState(true);
  const [recommendations, setRecs          ] = useState([]);
  const [recsLoading,     setRecsLoading   ] = useState(true);
  const [recentlyViewed,  setRecent        ] = useState([]);
  const [recentLoading,   setRecentLoading ] = useState(true);
  const [error,           setError         ] = useState('');

  // Modal state
  const [modalPropertyId, setModalPropertyId] = useState(null);

  const loadAll = useCallback(() => {
    setStatsLoading(true);
    renterAPI.getDashboard()
      .then(res => {
        const payload = res.data?.stats || res.data || {};
        setStats(payload.stats || payload);
      })
      .catch(() => setError('Failed to load dashboard stats.'))
      .finally(() => setStatsLoading(false));

    setRecsLoading(true);
    renterAPI.getRecommendations({ limit: 24 })
      .then(res => {
        const recs = res.data?.recommendations || res.data?.houses || res.data || [];
        setRecs(Array.isArray(recs) ? recs : []);
      })
      .catch(() => setRecs([]))
      .finally(() => setRecsLoading(false));

    setRecentLoading(true);
    renterAPI.getRecentlyViewed({ limit: 10 })
      .then(res => {
        const props = res.data?.properties || res.data?.houses || res.data || [];
        setRecent(Array.isArray(props) ? props : []);
      })
      .catch(() => setRecent([]))
      .finally(() => setRecentLoading(false));
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const firstName = user?.firstName || user?.email?.split('@')[0] || 'there';

  const STAT_CARDS = [
    {
      cls: 'red', label: 'Saved Properties', value: stats?.savedProperties,
      icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>,
    },
    {
      cls: 'blue', label: 'Active Bookings', value: stats?.activeBookings,
      icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
    },
    {
      cls: 'amber', label: 'Recently Viewed', value: stats?.recentlyViewed,
      icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>,
    },
    {
      cls: 'teal', label: 'Unread Messages', value: stats?.unreadMessages,
      icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>,
    },
  ];

  return (
    <RenterLayout>
      <style>{`
        @keyframes shimmer {
          0%   { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>

      {/* ── Header ── */}
      <div className="dashboard-header">
        <h1 className="dashboard-title">Hello, {firstName}!</h1>
        <p className="dashboard-subtitle">Let's find your perfect home today</p>
      </div>

      {error && (
        <div className="alert alert-error" style={{ marginBottom: 20 }}>{error}</div>
      )}

      {/* ── STAT CARDS ── */}
      <div className="stats-grid" style={{ marginBottom: 32 }}>
        {STAT_CARDS.map(s => (
          <div className="stat-card" key={s.label}>
            <div className={`stat-icon ${s.cls}`}>{s.icon}</div>
            <div className="stat-content">
              <div className="stat-value">
                {statsLoading ? <span style={{ color: '#CBD5E1' }}>—</span> : (s.value ?? 0)}
              </div>
              <div className="stat-label">{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ── RECOMMENDED FOR YOU ── */}
      <div style={{ marginBottom: 36 }}>
        <div className="section-header">
          <div>
            <div className="section-title">Recommended for You</div>
            <div className="section-subtitle">Based on your preferences and search history</div>
          </div>
          <Link to="/renter/search" className="view-all-btn">View All</Link>
        </div>
        <Slider
          items={recommendations}
          loading={recsLoading}
          skeletonCount={3}
          renderItem={p => (
            <PropertyCard key={p._id} property={p} onOpenModal={setModalPropertyId} />
          )}
          emptyState={
            <EmptyState
              emoji="🏠"
              title="No recommendations yet"
              desc="Start browsing properties to get personalised suggestions."
              to="/renter/search"
              btnLabel="Browse Properties"
            />
          }
        />
      </div>

      {/* ── RECENTLY VIEWED ── */}
      <div style={{ marginBottom: 32 }}>
        <div className="section-header">
          <div>
            <div className="section-title">Recently Viewed</div>
            <div className="section-subtitle">Continue where you left off</div>
          </div>
        </div>
        <Slider
          items={recentlyViewed}
          loading={recentLoading}
          skeletonCount={3}
          renderItem={p => (
            <PropertyCard key={p._id} property={p} onOpenModal={setModalPropertyId} />
          )}
          emptyState={
            <EmptyState
              emoji="👀"
              title="No recently viewed properties"
              desc="Browse properties to see your history here."
            />
          }
        />
      </div>

      {/* PropertyModal — mounted at dashboard level */}
      {modalPropertyId && (
        <PropertyModal
          propertyId={modalPropertyId}
          onClose={() => setModalPropertyId(null)}
        />
      )}
    </RenterLayout>
  );
}