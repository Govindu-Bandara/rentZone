import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { propertyAPI, landingAPI } from '../../services/api';
import {
  Search,
  Building2,
  Home,
  Hotel,
  Clock,
  MapPin,
  Shield,
  MessageCircle,
  Users,
  CheckCircle,
  Star,
  ArrowRight,
  Facebook,
  Twitter,
  Instagram,
  Linkedin,
} from 'lucide-react';

const Landing = () => {
  const navigate = useNavigate();
  const [featuredProperties, setFeaturedProperties] = useState([]);
  const [loadingProperties, setLoadingProperties] = useState(true);
  const [loadingStats, setLoadingStats] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [landingStats, setLandingStats] = useState({
    totalProperties: 0,
    totalRenters: 0,
    verifiedPercentage: 0,
    support: '24/7',
    propertyTypes: {
      apartments: 0,
      houses: 0,
      boardingPlaces: 0,
      shortStayRentals: 0,
    },
  });

  useEffect(() => {
    let isMounted = true;

    const loadData = async () => {
      try {
        const [statsResponse, propertiesResponse] = await Promise.all([
          landingAPI.getStats(),
          propertyAPI.getPublicProperties({ limit: 6, featured: 'true' }),
        ]);

        if (isMounted) {
          if (statsResponse.data.success) {
            setLandingStats(statsResponse.data.data);
          }
          const houses =
            propertiesResponse.data?.houses || propertiesResponse.data || [];
          setFeaturedProperties(houses);
        }
      } catch (error) {
        if (isMounted) {
          console.error('Error loading landing data:', error);
        }
      } finally {
        if (isMounted) {
          setLoadingStats(false);
          setLoadingProperties(false);
        }
      }
    };

    loadData();

    return () => {
      isMounted = false;
    };
  }, []);

  const handleSearch = (e) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigate(`/register?search=${encodeURIComponent(searchQuery)}`);
    } else {
      navigate('/register');
    }
  };

  const goToLogin = () => navigate('/login');
  const goToRegister = () => navigate('/register');

  const categories = [
    {
      icon: Building2,
      title: 'Apartments',
      count: loadingStats ? '...' : `${landingStats.propertyTypes.apartments}`,
      filter: 'Apartment',
      color: '#2563EB',
      bg: '#EFF6FF',
    },
    {
      icon: Home,
      title: 'Houses',
      count: loadingStats ? '...' : `${landingStats.propertyTypes.houses}`,
      filter: 'House',
      color: '#0D9488',
      bg: '#F0FDFA',
    },
    {
      icon: Hotel,
      title: 'Boarding Places',
      count: loadingStats
        ? '...'
        : `${landingStats.propertyTypes.boardingPlaces}`,
      filter: 'Boarding Place',
      color: '#7C3AED',
      bg: '#F5F3FF',
    },
    {
      icon: Clock,
      title: 'Short Stay Rentals',
      count: loadingStats
        ? '...'
        : `${landingStats.propertyTypes.shortStayRentals}`,
      filter: 'Short-Stay Rental',
      color: '#EA580C',
      bg: '#FFF7ED',
    },
  ];

  const stats = [
    {
      label: 'Properties Listed',
      value: loadingStats
        ? '...'
        : `${landingStats.totalProperties.toLocaleString()}+`,
      icon: Building2,
    },
    {
      label: 'Happy Renters',
      value: loadingStats
        ? '...'
        : `${landingStats.totalRenters.toLocaleString()}+`,
      icon: Users,
    },
    {
      label: 'Verified Owners',
      value: loadingStats ? '...' : `${landingStats.verifiedPercentage}%`,
      icon: Shield,
    },
    {
      label: 'Support Available',
      value: '24/7',
      icon: Clock,
    },
  ];

  const features = [
    {
      icon: Shield,
      title: 'Verified Listings',
      description:
        'All properties are thoroughly verified for your safety and peace of mind',
      color: '#0D9488',
      bg: '#F0FDFA',
    },
    {
      icon: MapPin,
      title: 'Map Search',
      description:
        'Find your perfect home with our interactive map-based search feature',
      color: '#2563EB',
      bg: '#EFF6FF',
    },
    {
      icon: MessageCircle,
      title: 'Real-Time Chat',
      description:
        'Connect instantly with property owners through our built-in messaging',
      color: '#7C3AED',
      bg: '#F5F3FF',
    },
  ];

  return (
    <div style={{ fontFamily: 'Inter, sans-serif', minHeight: '100vh', background: '#fff' }}>

      {/* ── NAVBAR ── */}
      <nav style={{
        position: 'sticky', top: 0, zIndex: 50,
        background: '#fff', borderBottom: '1px solid #F1F5F9',
        padding: '0 24px', height: 60,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <img src="/logo.png" alt="Rent Zone" style={{ width: 50, height: 50, borderRadius: 10 }} />
          <span style={{ fontWeight: 700, fontSize: 18, color: '#0F172A' }}>Rent Zone</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button type="button" onClick={goToLogin} style={{
            padding: '8px 20px', borderRadius: 8,
            color: '#0F172A', fontWeight: 500, fontSize: 14,
            textDecoration: 'none', transition: 'color .2s',
            background: 'transparent', border: 'none',
          }}
            onMouseEnter={e => e.currentTarget.style.color = '#0D9488'}
            onMouseLeave={e => e.currentTarget.style.color = '#0F172A'}
          >Login</button>
          <button type="button" onClick={goToRegister} style={{
            padding: '8px 20px', borderRadius: 8,
            background: 'linear-gradient(135deg, #0D9488, #2563EB)',
            color: '#fff', fontWeight: 600, fontSize: 14,
            textDecoration: 'none', border: 'none',
          }}>Register</button>
        </div>
      </nav>

      {/* ── HERO ── */}
      <section style={{
        position: 'relative',
        backgroundImage: 'url(/heroimage.jpg)',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        padding: '80px 0',
        overflow: 'hidden',
        minHeight: 550,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: '100%',
      }}>
        {/* Overlay */}
        <div style={{
          position: 'absolute', inset: 0, 
          background: 'linear-gradient(135deg, rgba(13, 148, 136, 0.85) 0%, rgba(3, 105, 161, 0.85) 50%, rgba(30, 64, 175, 0.85) 100%)',
        }} />
        <div style={{ position: 'relative', zIndex: 1, textAlign: 'center', maxWidth: 900 }}>
          <h1 style={{
            fontSize: 'clamp(28px, 5vw, 48px)', fontWeight: 800,
            color: '#fff', marginBottom: 16, lineHeight: 1.2,
          }}>
            Find Your Perfect Home to Rent
          </h1>
          <p style={{ fontSize: 16, color: 'rgba(255,255,255,.85)', marginBottom: 36 }}>
            Discover thousands of verified rental properties across Sri Lanka
          </p>

          {/* ✅ "Get Started" navigates to /register */}
          <button type="button" onClick={goToRegister} style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            padding: '14px 32px', borderRadius: 10,
            background: 'rgba(255,255,255,.15)', backdropFilter: 'blur(8px)',
            border: '1.5px solid rgba(255,255,255,.4)',
            color: '#fff', fontWeight: 600, fontSize: 16,
            textDecoration: 'none', transition: 'background .2s',
          }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,.25)'}
            onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,.15)'}
          >
            Get Started <ArrowRight size={18} />
          </button>
        </div>
      </section>

      {/* ── STATS BAR ── */}
      <section style={{ background: '#fff', padding: '48px 24px', borderBottom: '1px solid #F1F5F9' }}>
        <div style={{ maxWidth: 900, margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16 }}>
          {stats.map((stat, i) => (
            <div key={i} style={{ textAlign: 'center' }}>
              <stat.icon size={28} style={{ color: '#0D9488', marginBottom: 8 }} />
              <div style={{ fontSize: 28, fontWeight: 800, color: '#0F172A' }}>{stat.value}</div>
              <div style={{ fontSize: 13, color: '#64748B', marginTop: 2 }}>{stat.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── BROWSE BY CATEGORY ── */}
      <section style={{ background: '#F8FAFC', padding: '64px 24px' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 40 }}>
            <h2 style={{ fontSize: 28, fontWeight: 700, color: '#0F172A', marginBottom: 8 }}>
              Browse By Category
            </h2>
            <p style={{ color: '#64748B', fontSize: 15 }}>
              Choose from apartments, houses, boarding places, and more
            </p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16 }}>
            {categories.map((cat, i) => (
              <Link
                key={i}
                to="/register"
                style={{
                  background: '#fff', borderRadius: 14,
                  border: '1px solid #E2E8F0',
                  padding: '24px 16px', textAlign: 'left',
                  textDecoration: 'none', display: 'block',
                  transition: 'box-shadow .2s, transform .2s',
                  cursor: 'pointer',
                }}
                onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,.08)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
                onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.transform = 'none'; }}
              >
                <div style={{
                  width: 52, height: 52, borderRadius: 12,
                  background: cat.bg, display: 'flex',
                  alignItems: 'center', justifyContent: 'center',
                  marginBottom: 14,
                }}>
                  <cat.icon size={26} style={{ color: cat.color }} />
                </div>
                <div style={{ fontWeight: 700, fontSize: 15, color: '#0F172A', marginBottom: 4 }}>
                  {cat.title}
                </div>
                <div style={{ fontSize: 13, color: '#64748B' }}>{cat.count} Listings</div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ── WHY RENT ZONE ── */}
      <section style={{ background: '#fff', padding: '64px 24px' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 48 }}>
            <h2 style={{ fontSize: 28, fontWeight: 700, color: '#0F172A', marginBottom: 8 }}>
              Why Rent Zone ?
            </h2>
            <p style={{ color: '#64748B', fontSize: 15 }}>
              Everything you need for a seamless rental experience
            </p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 24 }}>
            {features.map((f, i) => (
              <div key={i} style={{
                background: '#F8FAFC', borderRadius: 16,
                padding: '32px 24px', textAlign: 'center',
                border: '1px solid #E2E8F0',
              }}>
                <div style={{
                  width: 60, height: 60, borderRadius: 16,
                  background: f.bg, display: 'flex',
                  alignItems: 'center', justifyContent: 'center',
                  margin: '0 auto 16px',
                }}>
                  <f.icon size={28} style={{ color: f.color }} />
                </div>
                <div style={{ fontWeight: 700, fontSize: 16, color: '#0F172A', marginBottom: 8 }}>
                  {f.title}
                </div>
                <div style={{ fontSize: 13, color: '#64748B', lineHeight: 1.6 }}>
                  {f.description}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer style={{ background: '#0F172A', padding: '48px 24px 24px', color: '#94A3B8' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr 1fr', gap: 40, marginBottom: 40 }}>
            {/* Brand */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <div style={{
                  width: 32, height: 32, borderRadius: 8,
                  background: 'linear-gradient(135deg, #0D9488, #2563EB)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#fff', fontWeight: 800, fontSize: 16,
                }}>R</div>
                <span style={{ fontWeight: 700, fontSize: 16, color: '#fff' }}>Rent Zone</span>
              </div>
              <p style={{ fontSize: 13, lineHeight: 1.7, maxWidth: 200 }}>
                Your trusted rental partner
              </p>
            </div>

            {/* Company */}
            <div>
              <div style={{ fontWeight: 600, fontSize: 14, color: '#fff', marginBottom: 16 }}>Company</div>
              {['About Us', 'Careers', 'Press'].map(item => (
                <div key={item} style={{ marginBottom: 10 }}>
                  <Link to="/" style={{ color: '#94A3B8', textDecoration: 'none', fontSize: 13 }}>{item}</Link>
                </div>
              ))}
            </div>

            {/* Support */}
            <div>
              <div style={{ fontWeight: 600, fontSize: 14, color: '#fff', marginBottom: 16 }}>Support</div>
              {['Help Center', 'Contact Us', 'Terms'].map(item => (
                <div key={item} style={{ marginBottom: 10 }}>
                  <Link to="/" style={{ color: '#94A3B8', textDecoration: 'none', fontSize: 13 }}>{item}</Link>
                </div>
              ))}
            </div>

            {/* Legal */}
            <div>
              <div style={{ fontWeight: 600, fontSize: 14, color: '#fff', marginBottom: 16 }}>Legal</div>
              {['Terms of Service', 'Privacy Policy', 'Cookie Policy'].map(item => (
                <div key={item} style={{ marginBottom: 10 }}>
                  <Link to="/" style={{ color: '#94A3B8', textDecoration: 'none', fontSize: 13 }}>{item}</Link>
                </div>
              ))}
            </div>
          </div>

          <div style={{
            borderTop: '1px solid #1E293B', paddingTop: 24,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <span style={{ fontSize: 13 }}>© 2026 Rent Zone. All rights reserved.</span>
            <div style={{ display: 'flex', gap: 12 }}>
              {[Facebook, Twitter, Instagram, Linkedin].map((Icon, i) => (
                <div key={i} style={{
                  width: 32, height: 32, borderRadius: 8, background: '#1E293B',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer',
                }}>
                  <Icon size={15} style={{ color: '#94A3B8' }} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Landing;