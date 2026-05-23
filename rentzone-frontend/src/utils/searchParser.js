/**
 * searchParser.js
 * Natural language query parser for Rent Zone search.
 * Converts free-text like "annex near university of colombo"
 * into structured API parameters.
 */

const PROPERTY_SYNONYMS = {
  // Boarding / Annex
  'annex':          'Boarding Place',
  'annexe':         'Boarding Place',
  'boarding':       'Boarding Place',
  'boarding place': 'Boarding Place',
  'boarding room':  'Boarding Place',
  'room':           'Boarding Place',
  'hostel':         'Boarding Place',
  'lodging':        'Boarding Place',

  // Apartment / Flat
  'apartment':      'Apartment',
  'apartments':     'Apartment',
  'flat':           'Apartment',
  'flats':          'Apartment',
  'apt':            'Apartment',
  'studio':         'Apartment',
  'condo':          'Apartment',
  'condominium':    'Apartment',

  // House / Villa
  'house':          'House',
  'houses':         'House',
  'villa':          'House',
  'villas':         'House',
  'bungalow':       'House',
  'home':           'House',
  'residence':      'House',
  'duplex':         'House',

  // Short-Stay
  'short stay':     'Short-Stay Rental',
  'short-stay':     'Short-Stay Rental',
  'shortstay':      'Short-Stay Rental',
  'holiday':        'Short-Stay Rental',
  'vacation':       'Short-Stay Rental',
  'airbnb':         'Short-Stay Rental',
  'daily rental':   'Short-Stay Rental',
  'weekly rental':  'Short-Stay Rental',
  'guest house':    'Short-Stay Rental',
  'guesthouse':     'Short-Stay Rental',
};

// Common Sri Lankan city aliases / abbreviations
const CITY_ALIASES = {
  'colombo':        'Colombo',
  'kandy':          'Kandy',
  'galle':          'Galle',
  'negombo':        'Negombo',
  'jaffna':         'Jaffna',
  'matara':         'Matara',
  'kurunegala':     'Kurunegala',
  'anuradhapura':   'Anuradhapura',
  'batticaloa':     'Batticaloa',
  'trincomalee':    'Trincomalee',
  'ratnapura':      'Ratnapura',
  'badulla':        'Badulla',
  'kotte':          'Sri Jayawardenepura Kotte',
  'kotte city':     'Sri Jayawardenepura Kotte',
  'nugegoda':       'Nugegoda',
  'maharagama':     'Maharagama',
  'moratuwa':       'Moratuwa',
  'dehiwala':       'Dehiwala',
  'mount lavinia':  'Mount Lavinia',
  'mt lavinia':     'Mount Lavinia',
  'kelaniya':       'Kelaniya',
  'rajagiriya':     'Rajagiriya',
  'malabe':         'Malabe',
  'kaduwela':       'Kaduwela',
  'nawala':         'Nawala',
  'wattala':        'Wattala',
  'ja ela':         'Ja-Ela',
  'ja-ela':         'Ja-Ela',
};

// Common landmark / institution keywords (used for landmark search)
const LANDMARK_KEYWORDS = [
  'university',
  'college',
  'school',
  'hospital',
  'temple',
  'church',
  'mosque',
  'station',
  'airport',
  'mall',
  'market',
  'beach',
  'park',
  'road',
  'street',
  'junction',
  'town',
  'zone',
  'institute',
];

// Proximity trigger words
const PROXIMITY_WORDS = [
  'near',
  'close to',
  'next to',
  'beside',
  'around',
  'by',
  'adjacent to',
  'opposite',
  'opposite to',
  'facing',
];

// Common misspellings → correct form
const SPELL_CORRECTIONS = {
  'jayawardena':    'jayawardenapura',
  'jayawardhana':   'jayawardenapura',
  'jayawardane':    'jayawardenapura',
  'colpmbo':        'colombo',
  'columbo':        'colombo',
  'canddy':         'kandy',
  'candy':          'kandy',
  'gale':           'galle',
  'negomba':        'negombo',
  'negomba':        'negombo',
  'trinco':         'trincomalee',
  'jaffana':        'jaffna',
};

// Words to strip when building clean search remainder
const STRIP_WORDS = [
  'for', 'rent', 'rental', 'rentals', 'to', 'a', 'an', 'the',
  'looking', 'need', 'want', 'find', 'search', 'any', 'available',
  'in', 'at', 'on', 'property', 'properties', 'place', 'spaces', 'space',
];

/**
 * Apply known spell corrections to a query string.
 */
function applySpellCorrections(text) {
  let result = text.toLowerCase();
  for (const [wrong, right] of Object.entries(SPELL_CORRECTIONS)) {
    result = result.replace(new RegExp(`\\b${wrong}\\b`, 'g'), right);
  }
  return result;
}

/**
 * Detect property type from query.
 * Checks multi-word synonyms first, then single-word.
 */
function detectPropertyType(q) {
  // Multi-word first
  const multiWord = Object.keys(PROPERTY_SYNONYMS).filter(k => k.includes(' ')).sort((a, b) => b.length - a.length);
  for (const kw of multiWord) {
    if (q.includes(kw)) return PROPERTY_SYNONYMS[kw];
  }
  // Single-word
  for (const [kw, type] of Object.entries(PROPERTY_SYNONYMS)) {
    if (!kw.includes(' ') && new RegExp(`\\b${kw}\\b`).test(q)) return type;
  }
  return null;
}

/**
 * Detect "near <landmark>" proximity hint.
 * Returns the landmark string or null.
 */
function detectLandmark(q) {
  for (const prox of PROXIMITY_WORDS.sort((a, b) => b.length - a.length)) {
    const idx = q.indexOf(prox);
    if (idx !== -1) {
      const after = q.slice(idx + prox.length).trim();
      if (after.length > 1) return after;
    }
  }
  return null;
}

/**
 * Detect city from "in <city>" or "at <city>" patterns,
 * or from a direct city name match anywhere in the query.
 */
function detectCity(q) {
  // Pattern: "in <city>" or "at <city>"
  const inMatch = q.match(/\b(?:in|at)\s+([a-z\s\-]+?)(?:\s+near|\s+close|\s+next|\s+beside|\s+around|\s+by|\s+adjacent|$)/i);
  if (inMatch) {
    const candidate = inMatch[1].trim().toLowerCase();
    if (CITY_ALIASES[candidate]) return CITY_ALIASES[candidate];
    // Return title-cased version even if not in alias map
    return candidate.replace(/\b\w/g, c => c.toUpperCase());
  }

  // Fallback: look for any city alias directly in the query
  const sortedAliases = Object.keys(CITY_ALIASES).sort((a, b) => b.length - a.length);
  for (const alias of sortedAliases) {
    if (new RegExp(`\\b${alias}\\b`).test(q)) return CITY_ALIASES[alias];
  }

  return null;
}

/**
 * Detect bedroom count from phrases like "2 bedroom", "3 bed", "two bedroom"
 */
function detectBedrooms(q) {
  const wordToNum = { one: 1, two: 2, three: 3, four: 4, five: 5 };
  const match = q.match(/(\d+|one|two|three|four|five)\s*(?:bed(?:room)?s?|br)/i);
  if (match) {
    const raw = match[1].toLowerCase();
    return isNaN(raw) ? wordToNum[raw] : parseInt(raw);
  }
  return null;
}

/**
 * Detect price ceiling from phrases like "under 30000", "below 50k", "max 25000"
 */
function detectMaxPrice(q) {
  const kMatch = q.match(/(?:under|below|max|maximum|less than|up to)\s*(?:lkr|rs\.?)?\s*(\d+)\s*k/i);
  if (kMatch) return parseInt(kMatch[1]) * 1000;

  const direct = q.match(/(?:under|below|max|maximum|less than|up to)\s*(?:lkr|rs\.?)?\s*([\d,]+)/i);
  if (direct) return parseInt(direct[1].replace(/,/g, ''));

  return null;
}

/**
 * Main parser function.
 * @param {string} rawQuery - The raw text from the search box.
 * @returns {Object} Structured params to merge into the API call.
 */
export function parseNaturalQuery(rawQuery) {
  if (!rawQuery || !rawQuery.trim()) return {};

  // Normalize + apply spell corrections
  let q = applySpellCorrections(rawQuery.trim().toLowerCase());

  const result = {
    propertyCategory: null,
    city: null,
    landmark: null,
    bedrooms: null,
    maxPrice: null,
    cleanSearch: null,
  };

  // 1. Extract property type
  result.propertyCategory = detectPropertyType(q);

  // 2. Extract proximity / landmark ("near university of xyz")
  result.landmark = detectLandmark(q);

  // 3. Extract city ("in colombo", "at kandy")
  result.city = detectCity(q);

  // 4. Extract bedroom count
  result.bedrooms = detectBedrooms(q);

  // 5. Extract price ceiling
  result.maxPrice = detectMaxPrice(q);

  // 6. Build clean remainder (for general text search)
  let leftover = q;

  // Remove proximity phrase and everything after
  for (const prox of PROXIMITY_WORDS.sort((a, b) => b.length - a.length)) {
    const idx = leftover.indexOf(prox);
    if (idx !== -1) {
      leftover = leftover.slice(0, idx);
      break;
    }
  }

  // Remove property type keywords
  for (const kw of Object.keys(PROPERTY_SYNONYMS).sort((a, b) => b.length - a.length)) {
    leftover = leftover.replace(new RegExp(`\\b${kw}\\b`, 'g'), '');
  }

  // Remove city
  if (result.city) {
    const cityLower = result.city.toLowerCase();
    leftover = leftover.replace(new RegExp(`\\b(?:in|at)\\s+${cityLower}\\b`, 'g'), '');
    leftover = leftover.replace(new RegExp(`\\b${cityLower}\\b`, 'g'), '');
  }

  // Remove strip words
  for (const w of STRIP_WORDS) {
    leftover = leftover.replace(new RegExp(`\\b${w}\\b`, 'g'), '');
  }

  // Remove price / bedroom fragments already extracted
  leftover = leftover
    .replace(/(?:under|below|max|maximum|less than|up to)\s*(?:lkr|rs\.?)?\s*[\d,]+k?/gi, '')
    .replace(/\d+\s*(?:bed(?:room)?s?|br)/gi, '');

  result.cleanSearch = leftover.replace(/\s+/g, ' ').trim() || null;

  // Remove nulls for cleaner output
  return Object.fromEntries(Object.entries(result).filter(([, v]) => v !== null));
}

/**
 * Merge parsed results into existing API params object.
 * Respects manually set filters (doesn't override them).
 *
 * @param {Object} parsed - Output of parseNaturalQuery()
 * @param {Object} existingParams - Params already built from filter UI
 * @param {Object} activeFilterTypes - propertyTypes object from UI { apartment: bool, ... }
 * @returns {Object} Final merged params
 */
export function mergeSearchParams(parsed, existingParams, activeFilterTypes) {
  const params = { ...existingParams };
  const hasManualTypeFilter = Object.values(activeFilterTypes || {}).some(Boolean);

  // Only apply parsed category if user hasn't manually picked a type
  if (parsed.propertyCategory && !hasManualTypeFilter && !params.propertyCategory) {
    params.propertyCategory = parsed.propertyCategory;
  }

  // City: only set if not already overridden by the location filter input
  if (parsed.city && !params.city && !params.location) {
    params.city = parsed.city;
  }

  // Landmark: use as the search term (backend searches location.landmark field)
  if (parsed.landmark) {
    params.search = parsed.landmark;
  } else if (parsed.cleanSearch) {
    params.search = parsed.cleanSearch;
  }

  // Bedrooms: only set if not already set by bedroom filter
  if (parsed.bedrooms && !params.bedrooms) {
    params.bedrooms = `${parsed.bedrooms}+`;
  }

  // Max price: only set if not already filtered
  if (parsed.maxPrice && !params.maxPrice) {
    params.maxPrice = parsed.maxPrice;
  }

  return params;
}