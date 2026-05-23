// src/components/common/Card.jsx
import React from 'react';
import { Home, MapPin, Bed, Bath, CheckCircle } from 'lucide-react';

const Card = ({ 
  property,
  onClick,
  className = '',
  showFavorite = true,
  isFavorite = false,
  onFavoriteClick
}) => {
  const {
    _id,
    title,
    images,
    location,
    propertyDetails,
    price,
    rentalType,
    isVerified,
    isFeatured
  } = property;

  const handleClick = () => {
    if (onClick) {
      onClick(property);
    } else {
      window.location.href = `/properties/${_id}`;
    }
  };

  return (
    <div 
      className={`bg-white rounded-xl overflow-hidden shadow-md hover:shadow-xl transition-all duration-300 cursor-pointer ${className}`}
      onClick={handleClick}
    >
      {/* Property Image */}
      <div className="relative h-48 overflow-hidden">
        <img 
          src={images?.[0] || 'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=400&h=300&fit=crop'} 
          alt={title}
          className="w-full h-full object-cover transition-transform duration-300 hover:scale-110"
        />
        
        {/* Badges */}
        <div className="absolute top-3 left-3 flex flex-col gap-1">
          {isFeatured && (
            <span className="bg-gradient-to-r from-[#2563EB] to-[#14B8A6] text-white px-3 py-1 rounded-full text-xs font-semibold">
              Featured
            </span>
          )}
          {isVerified && (
            <span className="bg-green-100 text-green-800 px-3 py-1 rounded-full text-xs font-semibold flex items-center">
              <CheckCircle className="w-3 h-3 mr-1" />
              Verified
            </span>
          )}
        </div>

        {/* Favorite Button */}
        {showFavorite && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onFavoriteClick?.(property);
            }}
            className="absolute top-3 right-3 bg-white rounded-full p-2 hover:bg-gray-100 transition-colors"
          >
            <svg 
              className={`w-5 h-5 ${isFavorite ? 'text-red-500 fill-red-500' : 'text-gray-500'}`} 
              fill="currentColor" 
              viewBox="0 0 20 20"
            >
              <path fillRule="evenodd" d="M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z" clipRule="evenodd" />
            </svg>
          </button>
        )}
      </div>

      {/* Property Details */}
      <div className="p-5">
        {/* Title */}
        <h3 className="text-lg font-semibold text-gray-900 mb-2 line-clamp-1">{title}</h3>
        
        {/* Location */}
        <div className="flex items-center text-gray-600 text-sm mb-3">
          <MapPin className="w-4 h-4 mr-1 flex-shrink-0" />
          <span className="line-clamp-1">{location?.city}, {location?.district}</span>
        </div>
        
        {/* Property Features */}
        <div className="flex items-center text-gray-600 text-sm mb-4 space-x-4">
          <div className="flex items-center">
            <Bed className="w-4 h-4 mr-1" />
            <span>{propertyDetails?.bedrooms || 0} Beds</span>
          </div>
          <div className="flex items-center">
            <Bath className="w-4 h-4 mr-1" />
            <span>{propertyDetails?.bathrooms || 0} Baths</span>
          </div>
          {propertyDetails?.squareFeet && (
            <div className="flex items-center">
              <Home className="w-4 h-4 mr-1" />
              <span>{propertyDetails.squareFeet} sqft</span>
            </div>
          )}
        </div>
        
        {/* Price */}
        <div className="flex items-center justify-between">
          <div>
            <span className="text-2xl font-bold text-[#2563EB]">
              LKR {price?.amount?.toLocaleString() || '0'}
            </span>
            <span className="text-gray-600 text-sm ml-1">
              /{rentalType === 'daily' ? 'day' : 'month'}
            </span>
          </div>
          
          <span className="px-3 py-1 bg-gray-100 text-gray-800 rounded-full text-sm font-medium">
            {property?.propertyType || 'Property'}
          </span>
        </div>
      </div>
    </div>
  );
};

export default Card;