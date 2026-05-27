import { useState, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import { Maximize2, MapPin } from 'lucide-react';
import toast from 'react-hot-toast';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

// Fix for default marker icon in Leaflet
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

// Component to update map view when coordinates change
function ChangeMapView({ center, zoom }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, zoom);
  }, [center, zoom, map]);
  return null;
}

// District coordinates in Sri Lanka
const DISTRICT_COORDINATES = {
  'Ampara': [7.2906, 81.6720],
  'Anuradhapura': [8.3114, 80.4037],
  'Badulla': [6.9934, 81.0550],
  'Batticaloa': [7.7310, 81.6747],
  'Colombo': [6.9271, 79.8612],
  'Galle': [6.0535, 80.2210],
  'Gampaha': [7.0840, 80.0098],
  'Hambantota': [6.1429, 81.1212],
  'Jaffna': [9.6615, 80.0255],
  'Kalutara': [6.6080, 79.9598],
  'Kandy': [7.2906, 80.6337],
  'Kegalle': [7.2513, 80.3464],
  'Kilinochchi': [9.3803, 80.3895],
  'Kurunegala': [7.4818, 80.3609],
  'Mannar': [8.9810, 79.9044],
  'Matale': [7.4675, 80.6234],
  'Matara': [5.9549, 80.5550],
  'Monaragala': [6.8728, 81.3507],
  'Mullaitivu': [9.2671, 80.8142],
  'Nuwara Eliya': [6.9497, 80.7891],
  'Polonnaruwa': [7.9403, 81.0188],
  'Puttalam': [8.0362, 79.8283],
  'Ratnapura': [6.7056, 80.3847],
  'Trincomalee': [8.5874, 81.2152],
  'Vavuniya': [8.7542, 80.4982]
};

// Default center for Sri Lanka
const SRI_LANKA_CENTER = [7.8731, 80.7718];
const DEFAULT_ZOOM = 8;

export default function LocationMap({ 
  city = '', 
  district = '', 
  onCityChange, 
  onDistrictChange,
  markerPosition,
  onMarkerPositionChange,
  userRole = 'owner',
  address = ''
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [mapCenter, setMapCenter] = useState(SRI_LANKA_CENTER);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.innerWidth <= 768
  );
  const [localMarkerPos, setLocalMarkerPos] = useState(markerPosition || SRI_LANKA_CENTER);
  const [gettingDirections, setGettingDirections] = useState(false);
  const mapContainerRef = useRef(null);

  const isRenterMode = userRole === 'renter';

  // Update map when city or district changes
  useEffect(() => {
    if (district && DISTRICT_COORDINATES[district]) {
      const coords = DISTRICT_COORDINATES[district];
      setMapCenter(coords);
      setLocalMarkerPos(coords);
      setZoom(11);
    } else {
      setMapCenter(SRI_LANKA_CENTER);
      setZoom(DEFAULT_ZOOM);
    }
  }, [city, district]);

  // Update local marker position when prop changes
  useEffect(() => {
    if (markerPosition && markerPosition.length === 2) {
      setLocalMarkerPos(markerPosition);
    }
  }, [markerPosition]);

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;

    try {
      // Using Nominatim geocoding service
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(searchQuery + ', Sri Lanka')}&format=json&limit=1`
      );
      const data = await response.json();

      if (data && data.length > 0) {
        const { lat, lon, display_name } = data[0];
        const newCoords = [parseFloat(lat), parseFloat(lon)];
        setMapCenter(newCoords);
        setLocalMarkerPos(newCoords);
        setZoom(13);

        // Try to extract city and district from the display name
        const parts = display_name.split(',').map(p => p.trim());
        if (parts.length > 0 && onCityChange) {
          onCityChange(parts[0]);
        }
        
        // Update marker position
        if (onMarkerPositionChange) {
          onMarkerPositionChange(newCoords);
        }
      } else {
        toast.error('Location not found. Please try a different search term.');
      }
    } catch (error) {
      console.error('Geocoding error:', error);
      toast.error('Failed to search location. Please try again.');
    }
  };

  const handleGetCurrentLocation = () => {
    if (!navigator.geolocation) {
      toast.error('Geolocation is not supported by your browser');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        const newCoords = [latitude, longitude];
        
        setMapCenter(newCoords);
        setLocalMarkerPos(newCoords);
        setZoom(15);

        // Update parent component
        if (onMarkerPositionChange) {
          onMarkerPositionChange(newCoords);
        }

        // Find the nearest district based on coordinates
        let nearestDistrict = '';
        let minDistance = Infinity;

        Object.entries(DISTRICT_COORDINATES).forEach(([districtName, coords]) => {
          const distance = Math.sqrt(
            Math.pow(coords[0] - latitude, 2) + Math.pow(coords[1] - longitude, 2)
          );
          if (distance < minDistance) {
            minDistance = distance;
            nearestDistrict = districtName;
          }
        });

        // Update district
        if (onDistrictChange && nearestDistrict) {
          onDistrictChange(nearestDistrict);
        }

        // Reverse geocode to get city name
        try {
          const response = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`,
            { timeout: 5000 }
          );
          const data = await response.json();
          
          if (data && data.address) {
            const cityName = data.address.city || data.address.town || data.address.village || data.address.suburb || '';
            
            if (onCityChange && cityName) {
              onCityChange(cityName);
            }
          }
        } catch (error) {
          console.error('Reverse geocoding error:', error);
          // Still show location even if geocoding fails
        }
      },
      (error) => {
        console.error('Geolocation error:', error);
        let errorMsg = 'Unable to retrieve your location.';
        
        if (error.code === 1) {
          errorMsg = 'Location permission denied. Please enable location access in your browser settings.';
        } else if (error.code === 2) {
          errorMsg = 'Location service unavailable. Please try again.';
        } else if (error.code === 3) {
          errorMsg = 'Location request timed out. Please try again.';
        }
        
        toast.error(errorMsg);
      },
      { 
        enableHighAccuracy: false, 
        timeout: 10000, 
        maximumAge: 0 
      }
    );
  };

  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
    
    // Prevent body scroll when fullscreen
    if (!isFullscreen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'auto';
    }
  };

  // Clean up on unmount
  useEffect(() => {
    return () => {
      document.body.style.overflow = 'auto';
    };
  }, []);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const handleMapClick = (e) => {
    if (isRenterMode) return; // read-only in renter mode
    const { lat, lng } = e.latlng;
    const newCoords = [lat, lng];
    setLocalMarkerPos(newCoords);
    
    if (onMarkerPositionChange) {
      onMarkerPositionChange(newCoords);
    }
  };

  const handleGetDirections = () => {
    if (!navigator.geolocation) {
      toast.error('Geolocation is not supported by your browser');
      return;
    }

    setGettingDirections(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        const destLat = localMarkerPos?.[0];
        const destLng = localMarkerPos?.[1];
        
        if (!destLat || !destLng) {
          toast.error('Property location not available');
          setGettingDirections(false);
          return;
        }

        // Open Google Maps with directions
        const mapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${latitude},${longitude}&destination=${destLat},${destLng}`;
        window.open(mapsUrl, '_blank');
        setGettingDirections(false);
      },
      (error) => {
        console.error('Geolocation error:', error);
        let errorMsg = 'Unable to retrieve your location.';
        if (error.code === 1) {
          errorMsg = 'Location permission denied. Please enable location access in your browser settings.';
        } else if (error.code === 2) {
          errorMsg = 'Location service unavailable. Please try again.';
        } else if (error.code === 3) {
          errorMsg = 'Location request timed out. Please try again.';
        }
        toast.error(errorMsg);
        setGettingDirections(false);
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 0 }
    );
  };

  return (
    <div 
      ref={mapContainerRef} 
      style={{ 
        width: '100%',
        height: isFullscreen ? '100vh' : 'auto',
        display: 'flex',
        flexDirection: 'column',
        position: isFullscreen ? 'fixed' : 'relative',
        top: isFullscreen ? 0 : 'auto',
        left: isFullscreen ? 0 : 'auto',
        right: isFullscreen ? 0 : 'auto',
        bottom: isFullscreen ? 0 : 'auto',
        zIndex: isFullscreen ? 9999 : 'auto',
        background: isFullscreen ? '#fff' : 'transparent'
      }}
    >
      {/* Search and Controls - hidden in renter read-only mode */}
      {!isRenterMode && (
        <div style={{ 
          display: 'flex', 
          gap: 12, 
          marginBottom: isFullscreen ? 16 : 16,
          flexWrap: 'wrap',
          flexDirection: isMobile ? 'column' : 'row',
          padding: isFullscreen ? '16px 20px' : '0',
          background: isFullscreen ? '#fff' : 'transparent',
          borderBottom: isFullscreen ? '1px solid #E2E8F0' : 'none',
          zIndex: 1001
        }}>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', gap: 8, width: '100%' }}>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="Search location (e.g., Colombo Fort, Galle Road)"
              style={{
                flex: 1,
                padding: '10px 14px',
                border: '1px solid #E2E8F0',
                borderRadius: 8,
                fontSize: 14,
                outline: 'none'
              }}
            />
            <button
              type="button"
              onClick={handleSearch}
              className="btn"
              style={{
                background: '#14B8A6',
                color: '#fff',
                padding: isMobile ? '10px 14px' : '10px 20px',
                fontSize: 14,
                fontWeight: 500
              }}
            >
              Search
            </button>
          </div>
          
          <button
            type="button"
            onClick={handleGetCurrentLocation}
            className="btn"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              background: '#F1F5F9',
              color: '#475569',
              padding: '10px 16px',
              fontSize: 14,
              fontWeight: 500,
              width: isMobile ? '100%' : 'auto',
              justifyContent: isMobile ? 'center' : 'flex-start'
            }}
          >
            <MapPin size={16} />
            Use Current Location
          </button>
        </div>
      )}

      {/* Renter mode controls */}
      {isRenterMode && (
        <div style={{
          display: 'flex',
          gap: 8,
          flexWrap: 'wrap',
          padding: isFullscreen ? '16px 20px' : '8px 0',
          background: isFullscreen ? '#fff' : 'transparent',
          borderBottom: isFullscreen ? '1px solid #E2E8F0' : 'none',
          zIndex: 1001
        }}>
          <button
            type="button"
            onClick={handleGetDirections}
            disabled={gettingDirections}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              background: '#2563EB',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              padding: '10px 16px',
              fontSize: 14,
              fontWeight: 600,
              cursor: gettingDirections ? 'not-allowed' : 'pointer',
              opacity: gettingDirections ? 0.7 : 1
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
            {gettingDirections ? 'Getting Direction...' : 'Get Directions'}
          </button>
          {address && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 12px',
              background: '#F0F9FF',
              borderRadius: 8,
              fontSize: 12,
              color: '#0369A1',
              flex: 1,
              minWidth: isMobile ? '100%' : 0
            }}>
              <MapPin size={14} />
              {address}
            </div>
          )}
        </div>
      )}

      {/* Map Container */}
      <div style={{ 
        position: 'relative', 
        borderRadius: isFullscreen ? 0 : 12, 
        overflow: 'hidden', 
        border: isFullscreen ? 'none' : '1px solid #E2E8F0',
        height: isFullscreen ? 'auto' : (isMobile ? 320 : 400),
        flex: isFullscreen ? 1 : 'none',
        display: 'flex'
      }}>
        <MapContainer
          center={mapCenter}
          zoom={zoom}
          style={{ 
            height: '100%', 
            width: '100%',
            zIndex: 1
          }}
          onClick={handleMapClick}
        >
          <ChangeMapView center={mapCenter} zoom={zoom} />
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {localMarkerPos && (
            <Marker position={localMarkerPos} draggable={true} eventHandlers={{
              dragend: (e) => {
                const marker = e.target;
                const position = marker.getLatLng();
                const newCoords = [position.lat, position.lng];
                setLocalMarkerPos(newCoords);
                if (onMarkerPositionChange) {
                  onMarkerPositionChange(newCoords);
                }
              }
            }}>
              <Popup>
                {city || 'Property Location'}<br />
                {district && `District: ${district}`}
              </Popup>
            </Marker>
          )}
        </MapContainer>

        {/* Fullscreen Button */}
        <button
          type="button"
          onClick={toggleFullscreen}
          style={{
            position: 'absolute',
            top: 10,
            right: 10,
            zIndex: 1000,
            background: '#2563EB',
            border: 'none',
            borderRadius: 10,
            padding: isMobile ? 9 : 12,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 8px 24px rgba(37,99,235,0.16)'
          }}
          title="Toggle Fullscreen"
        >
          <Maximize2 size={18} color="#fff" />
        </button>
      </div>

      {!isFullscreen && !isRenterMode && (
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 8 }}>
          Click on the map or drag the marker to set the exact location. You can also search for a location above.
        </p>
      )}
    </div>
  );
}
