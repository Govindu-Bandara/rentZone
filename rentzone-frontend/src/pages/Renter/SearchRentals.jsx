import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import RenterLayout from '../../components/common/RenterLayout';
import { propertyAPI, favoriteAPI } from '../../services/api';
import { parseNaturalQuery, mergeSearchParams } from '../../utils/searchParser';
import PropertyModal from '../../components/common/PropertyModal';

const MAX_PRICE = 1000000;
const PROPERTY_TYPE_PARAM_MAP = {
  apartment: 'Apartment',
  house: 'House',
  boarding: 'Boarding Place',
  shortStay: 'Short-Stay Rental',
};
const AMENITY_PARAM_MAP = {
  parking: 'parking',
  petFriendly: 'petFriendly',
  gym: 'gym',
  pool: 'pool',
  laundry: 'washerDryer',
  acHeating: 'ac',
};

function createInitialFilters(location = '') {
  return {
    search: location,
    location: '',
    minPrice: 0,
    maxPrice: MAX_PRICE,
    propertyTypes: { apartment: false, house: false, boarding: false, shortStay: false },
    bedrooms: 'Any',
    bathrooms: 'Any',
    amenities: { parking: false, petFriendly: false, gym: false, pool: false, laundry: false, acHeating: false },
  };
}

// ─── Backend handles fallback strategies ───────────────────────────────────
// The Lambda function automatically cascades through 5 fallback levels.
// We trust the backend response and display its fallback.message when applied.

// ─── Sub-components ────────────────────────────────────────────────────────

function SearchHints({ onSelect }) {
  const hints = ['houses in colombo', 'annex near university', 'apartment in kandy', 'flat under 30000', 'boarding near hospital', '2 bedroom house'];
  return (
    <div className="search-hints">
      {hints.map(h => (
        <button key={h} type="button" className="search-hint-pill" onClick={() => onSelect(h)}>{h}</button>
      ))}
    </div>
  );
}

function ParsedQueryInfo({ parsed }) {
  if (!parsed || Object.keys(parsed).length === 0) return null;
  const parts = [];
  if (parsed.propertyCategory) parts.push({ label: 'Type', value: parsed.propertyCategory });
  if (parsed.city)             parts.push({ label: 'City', value: parsed.city });
  if (parsed.landmark)         parts.push({ label: 'Near', value: parsed.landmark });
  if (parsed.bedrooms)         parts.push({ label: 'Beds', value: `${parsed.bedrooms}+` });
  if (parsed.maxPrice)         parts.push({ label: 'Max',  value: `LKR ${parsed.maxPrice.toLocaleString()}` });
  if (!parts.length) return null;
  return (
    <div className="parsed-query-info">
      <span className="parsed-query-label">Searching for:</span>
      {parts.map(p => (
        <span key={p.label} className="parsed-query-badge">
          <span className="parsed-query-key">{p.label}</span>
          <span className="parsed-query-val">{p.value}</span>
        </span>
      ))}
    </div>
  );
}

// Banner shown when we're displaying fallback results instead of exact matches
function FallbackBanner({ label, originalQuery, onClear }) {
  return (
    <div className="fallback-banner">
      <div className="fallback-banner-icon">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8"/><path d="M11 8v3l2 2"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
      </div>
      <div className="fallback-banner-text">
        <span className="fallback-banner-title">No exact matches for <em>"{originalQuery}"</em></span>
        <span className="fallback-banner-sub">Showing nearest results: <strong>{label}</strong></span>
      </div>
      <button className="fallback-banner-clear" onClick={onClear}>
        Clear search
      </button>
    </div>
  );
}

function PropertyCard({ property, onOpenModal }) {
  const [faved, setFaved] = useState(property.isFavorite || false);
  const [favLoading, setFavLoading] = useState(false);
  const typeLabel = {
    Apartment: 'Apartment', House: 'House',
    'Boarding Place': 'Boarding Place', 'Short-Stay Rental': 'Short-Stay Rental',
  }[property.propertyType] || property.propertyType;
  const typeColor = {
    Apartment: 'badge-blue', House: 'badge-teal',
    'Boarding Place': 'badge-amber', 'Short-Stay Rental': 'badge-gray',
  }[property.propertyType] || 'badge-blue';
  const priceUnit  = property.rentalType === 'daily' || property.rentalType === 'short_stay' ? '/day' : '/mo';
  const imageSrc   = property.images?.[0]?.url || property.images?.[0] || 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=500&auto=format&fit=crop&q=60';
  const displayImageSrc = property.mainImage?.url || property.mainImage || imageSrc;
  const bedrooms   = property.propertyDetails?.bedrooms ?? property.bedrooms ?? 0;
  const bathrooms  = property.propertyDetails?.bathrooms ?? property.bathrooms ?? 0;
  const priceAmount = typeof property.price === 'object' ? property.price?.amount : property.price;

  const handleToggleFavorite = async (e) => {
    e.stopPropagation();
    setFavLoading(true);
    try {
      if (faved) {
        await favoriteAPI.removeFavorite(property._id);
        setFaved(false);
      } else {
        await favoriteAPI.addFavorite(property._id);
        setFaved(true);
      }
    } catch {
      setFaved(prev => !prev);
    } finally {
      setFavLoading(false);
    }
  };

  return (
    <div className="property-card" style={{ cursor: 'pointer' }} onClick={() => onOpenModal(property._id)}>
      <div className="property-card-image">
        <img src={displayImageSrc} alt={property.title} loading="lazy" />
        <div className="property-card-badges">
          <span className={`badge ${typeColor}`}>{typeLabel}</span>
          {property.isVerified && <span className="badge badge-verified">Verified</span>}
        </div>
        <button
          className={`property-card-fav${faved ? ' active' : ''}`}
          onClick={handleToggleFavorite}
          disabled={favLoading}
          aria-label="Toggle favourite"
        >
          {favLoading ? (
            <div className="spinner spinner-sm" style={{ width: 12, height: 12, borderWidth: 2 }} />
          ) : (
            <svg width="15" height="15" viewBox="0 0 24 24" fill={faved ? '#EF4444' : 'none'} stroke={faved ? '#EF4444' : 'currentColor'} strokeWidth="2">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
          )}
        </button>
      </div>
      <div className="property-card-body">
        <div className="property-card-title">{property.title}</div>
        <div className="property-card-location">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
          </svg>
          {property.location?.city}, {property.location?.country || 'Sri Lanka'}
        </div>
        <div className="property-card-meta">
          <span>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M2 4v16M2 8h18a2 2 0 0 1 2 2v6H2M2 12h20"/>
            </svg>{bedrooms} Beds
          </span>
          <span>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 12h16a1 1 0 0 1 1 1v3a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4v-3a1 1 0 0 1 1-1zM6 12V5a2 2 0 0 1 2-2h3v2.25"/>
            </svg>{bathrooms} Baths
          </span>
        </div>
        <div className="property-card-price">
          LKR {(priceAmount || 0).toLocaleString()}<span>{priceUnit}</span>
        </div>
      </div>
    </div>
  );
}

function CheckRow({ label, checked, onChange }) {
  return (
    <label className="filter-check-row">
      <span className="filter-check-label">{label}</span>
      <input type="checkbox" checked={checked} onChange={onChange} />
    </label>
  );
}

function BtnGroup({ options, value, onChange }) {
  return (
    <div className="btn-group-filter">
      {options.map(opt => (
        <button
          key={opt} type="button"
          className={`btn-group-item${value === opt ? ' active' : ''}`}
          onClick={() => onChange(opt)}
        >{opt}</button>
      ))}
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────

export default function SearchRentals() {
  const [searchParams]    = useSearchParams();
  const [filters, setFilters]               = useState(() => createInitialFilters());
  const [appliedFilters, setAppliedFilters] = useState(() => createInitialFilters());
  const [properties, setProperties]         = useState([]);
  const [loading, setLoading]               = useState(true);
  const [error, setError]                   = useState('');
  const [showFilters, setShowFilters]       = useState(false);
  const [parsedQuery, setParsedQuery]       = useState({});
  const [showHints, setShowHints]           = useState(false);
  const [modalPropertyId, setModalPropertyId] = useState(null);

  // Fallback state
  const [fallbackLabel, setFallbackLabel]   = useState('');   // non-empty = showing fallback
  const [originalQuery, setOriginalQuery]   = useState('');
  const searchInputRef = useRef(null);

  const fetchProperties = useCallback(async (f) => {
    setLoading(true);
    setError('');
    setFallbackLabel('');

    try {
      const trimmedSearch = f.search?.trim() || '';
      const parsed = trimmedSearch ? parseNaturalQuery(trimmedSearch) : {};
      setParsedQuery(parsed);

      const activeTypes = Object.entries(f.propertyTypes)
        .filter(([, v]) => v)
        .map(([k]) => PROPERTY_TYPE_PARAM_MAP[k])
        .filter(Boolean);

      const activeAmenities = Object.entries(f.amenities)
        .filter(([, v]) => v)
        .map(([k]) => AMENITY_PARAM_MAP[k])
        .filter(Boolean);

      // Build query params for single API call
      const params = { page: 1, limit: 1000 };
      if (trimmedSearch)          params.search = trimmedSearch;
      if (f.location?.trim())     params.location = f.location.trim();
      if (f.minPrice > 0)         params.minPrice = f.minPrice;
      if (f.maxPrice < MAX_PRICE) params.maxPrice = f.maxPrice;
      if (activeTypes.length > 0) params.propertyCategory = activeTypes.join(',');
      if (f.bedrooms !== 'Any')   params.bedrooms = f.bedrooms;
      if (f.bathrooms !== 'Any')  params.bathrooms = f.bathrooms;
      if (activeAmenities.length > 0) params.amenities = activeAmenities.join(',');

      // Merge NL parsed query with manual filters
      const finalParams = mergeSearchParams(parsed, params, f.propertyTypes);

      // Single API call — backend handles all fallback strategies
      const res = await propertyAPI.searchProperties(finalParams);
      const results = res.data?.houses || res.data || [];
      const fallbackInfo = res.data?.fallback;

      setProperties(results);

      // If backend applied fallback, show the banner with its message
      if (fallbackInfo?.applied) {
        setOriginalQuery(trimmedSearch || f.location?.trim() || 'your search');
        setFallbackLabel(fallbackInfo.message || fallbackInfo.reason || '');
      }

    } catch {
      setError('Failed to load properties.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchProperties(appliedFilters); }, [appliedFilters, fetchProperties]);

  useEffect(() => {
    const q = searchParams.get('q')?.trim() || '';
    const next = createInitialFilters(q);
    setFilters(next);
    setAppliedFilters(next);
  }, [searchParams]);

  const handleApply = () => setAppliedFilters({ ...filters });
  const handleSearchSubmit = e => { e.preventDefault(); setShowHints(false); handleApply(); };
  const handleClear = () => {
    const c = createInitialFilters();
    setFilters(c);
    setAppliedFilters(c);
    setParsedQuery({});
    setFallbackLabel('');
  };
  const handleHintSelect = h => {
    const n = { ...filters, search: h };
    setFilters(n);
    setAppliedFilters(n);
    setShowHints(false);
  };
  const focusSearchInput = () => {
    searchInputRef.current?.focus();
  };
  const setPropType = k => setFilters(f => ({ ...f, propertyTypes: { ...f.propertyTypes, [k]: !f.propertyTypes[k] } }));
  const setAmenity  = k => setFilters(f => ({ ...f, amenities: { ...f.amenities, [k]: !f.amenities[k] } }));

  const hasActiveFilters = appliedFilters.search?.trim() ||
    appliedFilters.location?.trim() ||
    appliedFilters.minPrice > 0 ||
    appliedFilters.maxPrice < MAX_PRICE ||
    Object.values(appliedFilters.propertyTypes).some(Boolean) ||
    appliedFilters.bedrooms !== 'Any' ||
    appliedFilters.bathrooms !== 'Any' ||
    Object.values(appliedFilters.amenities).some(Boolean);

  return (
    <RenterLayout>
      <div className="search-toolbar-card">
        <form className="search-toolbar" onSubmit={handleSearchSubmit}>
          <div className="search-toolbar-input-wrap" style={{ position: 'relative' }}>
            <span className="search-toolbar-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
            </span>
            <input
              ref={searchInputRef}
              type="text"
              className="form-input search-toolbar-input"
              placeholder='Try "annex near university", "house in kandy", "2 bedroom flat"'
              value={filters.search}
              onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
              onFocus={() => setShowHints(true)}
              onBlur={() => setTimeout(() => setShowHints(false), 150)}
              autoComplete="off"
            />
            {showHints && (
              <div
                onMouseDown={e => {
                  e.preventDefault();
                  focusSearchInput();
                }}
              >
                <SearchHints onSelect={handleHintSelect} />
              </div>
            )}
          </div>
          <div className="search-toolbar-actions">
            <button
              type="button" className="btn"
              onClick={() => setShowFilters(v => !v)}
              style={{
                background: showFilters ? 'var(--primary)' : '#F1F5F9',
                color: showFilters ? '#fff' : '#64748B',
                border: 'none',
              }}
            >
              {showFilters ? 'Hide Filters' : 'Show Filters'}
            </button>
            <button type="submit" className="btn btn-primary">Search</button>
          </div>
        </form>
        <ParsedQueryInfo parsed={parsedQuery} />
      </div>

      <div className={`search-page${showFilters ? '' : ' filters-hidden'}`}>
        {showFilters && (
          <aside className="filter-panel">
            <div className="filter-header">
              <h2 className="filter-title">Filters</h2>
              <button className="filter-clear" onClick={handleClear}>Clear All</button>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>
              Refine results with optional filters.
            </div>
            <div className="filter-section">
              <div className="filter-label">Location</div>
              <div className="input-wrapper">
                <input
                  type="text" className="form-input"
                  placeholder="City, Town, District"
                  value={filters.location}
                  onChange={e => setFilters(f => ({ ...f, location: e.target.value }))}
                />
              </div>
            </div>
            <div className="filter-section">
              <div className="filter-label">Price Range</div>
              <input
                type="range" className="price-slider"
                min={0} max={MAX_PRICE} step={5000}
                value={filters.maxPrice}
                onChange={e => setFilters(f => ({ ...f, maxPrice: +e.target.value }))}
              />
              <div className="price-range-labels">
                <span>LKR 0</span><span>LKR {filters.maxPrice.toLocaleString()}</span>
              </div>
            </div>
            <div className="filter-section">
              <div className="filter-label">Property Category</div>
              <CheckRow label="Apartment"         checked={filters.propertyTypes.apartment} onChange={() => setPropType('apartment')} />
              <CheckRow label="House"             checked={filters.propertyTypes.house}      onChange={() => setPropType('house')} />
              <CheckRow label="Boarding Place"    checked={filters.propertyTypes.boarding}   onChange={() => setPropType('boarding')} />
              <CheckRow label="Short-Stay Rental" checked={filters.propertyTypes.shortStay}  onChange={() => setPropType('shortStay')} />
            </div>
            <div className="filter-section">
              <div className="filter-label">Bedrooms</div>
              <BtnGroup options={['Any', '1+', '2+', '3+', '4+']} value={filters.bedrooms} onChange={v => setFilters(f => ({ ...f, bedrooms: v }))} />
            </div>
            <div className="filter-section">
              <div className="filter-label">Bathrooms</div>
              <BtnGroup options={['Any', '1+', '2+', '3+']} value={filters.bathrooms} onChange={v => setFilters(f => ({ ...f, bathrooms: v }))} />
            </div>
            <div className="filter-section">
              <div className="filter-label">Amenities</div>
              <CheckRow label="Parking"      checked={filters.amenities.parking}     onChange={() => setAmenity('parking')} />
              <CheckRow label="Pet Friendly" checked={filters.amenities.petFriendly} onChange={() => setAmenity('petFriendly')} />
              <CheckRow label="Gym"          checked={filters.amenities.gym}         onChange={() => setAmenity('gym')} />
              <CheckRow label="Pool"         checked={filters.amenities.pool}        onChange={() => setAmenity('pool')} />
              <CheckRow label="Laundry"      checked={filters.amenities.laundry}     onChange={() => setAmenity('laundry')} />
              <CheckRow label="AC/Heating"   checked={filters.amenities.acHeating}   onChange={() => setAmenity('acHeating')} />
            </div>
            <button className="btn btn-primary btn-full" onClick={handleApply}>Apply Filters</button>
          </aside>
        )}

        <div className="search-results">
          {loading ? (
            <div className="loading-state">
              <div className="loading-dots">
                <span /><span /><span />
              </div>
              <div className="loading-label">Finding the best matches…</div>
            </div>
          ) : error ? (
            <div className="alert alert-error">{error}</div>
          ) : properties.length === 0 ? (
            /* True empty state — even all fallbacks returned nothing */
            <div className="empty-state" style={{ paddingTop: 80 }}>
              <div className="empty-icon">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
              </div>
              <div className="empty-title">No properties available right now</div>
              <div className="empty-desc">
                We couldn't find any listings matching your search. Try a different city or check back later.
              </div>
              <SearchHints onSelect={handleHintSelect} />
              {hasActiveFilters && (
                <button className="btn btn-secondary btn-sm" style={{ marginTop: 16 }} onClick={handleClear}>
                  Clear Filters
                </button>
              )}
            </div>
          ) : (
            <>
              {/* Fallback banner when showing nearest results */}
              {fallbackLabel && (
                <FallbackBanner
                  label={fallbackLabel}
                  originalQuery={originalQuery}
                  onClear={handleClear}
                />
              )}

              <div style={{ marginBottom: 12, fontSize: 13, color: 'var(--text-secondary)' }}>
                {fallbackLabel
                  ? `${properties.length} similar ${properties.length === 1 ? 'property' : 'properties'} nearby`
                  : `${properties.length} ${properties.length === 1 ? 'property' : 'properties'} found`
                }
              </div>

              <div className="search-grid">
                {properties.map(p => (
                  <PropertyCard key={p._id} property={p} onOpenModal={setModalPropertyId} />
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <style>{`
        /* ── Search hints ── */
        .search-hints {
          position: absolute; top: calc(100% + 6px); left: 0; right: 0;
          background: var(--color-background-primary, #fff);
          border: 1px solid #e2e8f0; border-radius: 10px;
          padding: 10px 12px; display: flex; flex-wrap: wrap; gap: 6px;
          cursor: text;
          z-index: 100; box-shadow: 0 4px 16px rgba(0,0,0,0.08);
        }
        .search-hint-pill {
          background: #F1F5F9; border: none; border-radius: 20px;
          padding: 4px 12px; font-size: 12px; color: #475569; cursor: pointer;
          transition: background 0.15s;
        }
        .search-hint-pill:hover { background: #E2E8F0; }

        /* ── Parsed query ── */
        .parsed-query-info {
          display: flex; flex-wrap: wrap; align-items: center;
          gap: 6px; padding: 8px 0 2px; font-size: 12px;
        }
        .parsed-query-label { color: #64748B; }
        .parsed-query-badge {
          display: inline-flex; border-radius: 6px;
          overflow: hidden; border: 1px solid #CBD5E1; font-size: 11px;
        }
        .parsed-query-key { background: #E2E8F0; padding: 2px 6px; color: #475569; font-weight: 500; }
        .parsed-query-val { background: #fff; padding: 2px 8px; color: #1E293B; }

        /* ── Fallback banner ── */
        .fallback-banner {
          display: flex; align-items: flex-start; gap: 10px;
          background: #FFF7ED; border: 1px solid #FED7AA;
          border-radius: 10px; padding: 12px 14px; margin-bottom: 14px;
        }
        .fallback-banner-icon {
          flex-shrink: 0; width: 28px; height: 28px;
          background: #FFEDD5; border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          color: #EA580C; margin-top: 1px;
        }
        .fallback-banner-text {
          flex: 1; display: flex; flex-direction: column; gap: 2px;
        }
        .fallback-banner-title {
          font-size: 13px; color: #9A3412; font-weight: 500;
        }
        .fallback-banner-title em { font-style: normal; }
        .fallback-banner-sub {
          font-size: 12px; color: #C2410C;
        }
        .fallback-banner-sub strong { font-weight: 600; }
        .fallback-banner-clear {
          flex-shrink: 0; background: none; border: 1px solid #FDBA74;
          border-radius: 6px; padding: 4px 10px; font-size: 12px;
          color: #EA580C; cursor: pointer; white-space: nowrap;
          transition: background 0.15s;
        }
        .fallback-banner-clear:hover { background: #FFEDD5; }

        /* ── Loading dots ── */
        .loading-state {
          display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          padding: 80px 0; gap: 12px;
        }
        .loading-dots {
          display: flex; gap: 6px; align-items: center;
        }
        .loading-dots span {
          width: 8px; height: 8px; border-radius: 50%;
          background: var(--primary, #6366F1);
          animation: dotBounce 1.2s infinite ease-in-out;
        }
        .loading-dots span:nth-child(2) { animation-delay: 0.2s; }
        .loading-dots span:nth-child(3) { animation-delay: 0.4s; }
        .loading-label {
          font-size: 13px; color: var(--text-secondary, #64748B);
        }
        @keyframes dotBounce {
          0%, 80%, 100% { transform: scale(0.7); opacity: 0.5; }
          40%            { transform: scale(1);   opacity: 1; }
        }
      `}</style>

      {modalPropertyId && (
        <PropertyModal propertyId={modalPropertyId} onClose={() => setModalPropertyId(null)} />
      )}
    </RenterLayout>
  );
}