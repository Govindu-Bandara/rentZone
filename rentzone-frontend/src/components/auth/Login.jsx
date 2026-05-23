import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { authAPI } from '../../services/api';

export default function Login() {
  const navigate = useNavigate();
  const { login } = useAuth();

  const [form, setForm] = useState({ email: '', password: '', rememberMe: false });
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setForm(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
    if (error) setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!form.email || !form.password) {
      setError('Please enter your email and password.');
      return;
    }

    setLoading(true);
    try {
      const res = await authAPI.login({ email: form.email, password: form.password });
      const { accessToken, refreshToken, user } = res.data;

      login(user, accessToken, refreshToken);

      if (form.rememberMe) {
        localStorage.setItem('rememberMe', 'true');
      }

      // Role-based redirect
      const normalizedRole = user.role === 'landlord' ? 'owner' : user.role;
      if (normalizedRole === 'admin') navigate('/admin/dashboard');
      else if (normalizedRole === 'owner') navigate('/owner/dashboard');
      else navigate('/renter/dashboard');

    } catch (err) {
      const data = err?.response?.data || err?.data || {};
      const msg  = data.error || data.message || 'Invalid email or password.';

      // If account needs email verification, redirect to verify page
      if (data.requiresVerification && data.userId) {
        navigate('/verify-email', {
          state: { userId: data.userId, email: form.email }
        });
        return;
      }

      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      {/* Hero Panel */}
      <div className="auth-hero">
        <img
          src="https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=900&auto=format&fit=crop&q=60"
          alt="Modern apartment building"
          className="auth-hero-bg"
        />
        <div className="auth-hero-overlay" />
        <div className="auth-hero-content">
          <div className="auth-hero-logo">
            <img src="/logo.png" alt="Rent Zone" style={{ width: 72, height: 72, borderRadius: 12 }} />
            <span className="auth-hero-logo-text">Rent Zone</span>
          </div>
          <h1 className="auth-hero-title">Welcome Back!</h1>
          <p className="auth-hero-subtitle">
            Sign in to access your dashboard and manage your rental journey seamlessly.
          </p>
          <div className="auth-hero-features">
            <div className="auth-hero-feature">
              <div className="auth-hero-feature-dot" />
              Verified listings only
            </div>
            <div className="auth-hero-feature">
              <div className="auth-hero-feature-dot" />
              Secure payment solutions
            </div>
            <div className="auth-hero-feature">
              <div className="auth-hero-feature-dot" />
              24/7 customer support
            </div>
          </div>
        </div>
      </div>

      {/* Form Panel */}
      <div className="auth-panel">
        <div className="auth-form-container">
          <div className="auth-form-header">
            <h2 className="auth-form-title">Sign In</h2>
            <p className="auth-form-subtitle">Access your Rent Zone account</p>
          </div>

          {error && (
            <div className="auth-error" style={{ marginBottom: 16 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              {error}
            </div>
          )}

          <form className="auth-form" onSubmit={handleSubmit}>
            {/* Email */}
            <div className="form-group">
              <label className="form-label">Email Address</label>
              <div className="input-wrapper">
                <span className="input-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                    <polyline points="22,6 12,13 2,6"/>
                  </svg>
                </span>
                <input
                  type="email"
                  name="email"
                  className="form-input has-icon"
                  placeholder="you@example.com"
                  value={form.email}
                  onChange={handleChange}
                  autoComplete="email"
                  autoFocus
                />
              </div>
            </div>

            {/* Password */}
            <div className="form-group">
              <div className="forgot-row">
                <label className="form-label">Password</label>
                <Link to="/forgot-password" className="forgot-link">Forgot Password?</Link>
              </div>
              <div className="input-wrapper">
                <span className="input-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                  </svg>
                </span>
                <input
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  className="form-input has-icon"
                  placeholder="••••••••"
                  value={form.password}
                  onChange={handleChange}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className="input-toggle"
                  onClick={() => setShowPassword(v => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                      <line x1="1" y1="1" x2="23" y2="23"/>
                    </svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                      <circle cx="12" cy="12" r="3"/>
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {/* Remember Me */}
            <label className="checkbox-wrapper">
              <input
                type="checkbox"
                name="rememberMe"
                checked={form.rememberMe}
                onChange={handleChange}
              />
              <span className="checkbox-label">Remember Me</span>
            </label>

            {/* Submit */}
            <button
              type="submit"
              className={`btn btn-primary btn-lg btn-full${loading ? ' btn-loading' : ''}`}
              disabled={loading}
            >
              {!loading && (
                <>
                  Sign In
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <line x1="5" y1="12" x2="19" y2="12"/>
                    <polyline points="12 5 19 12 12 19"/>
                  </svg>
                </>
              )}
            </button>
          </form>

          <p className="auth-form-footer" style={{ marginTop: 20 }}>
            Don't have an account?{' '}
            <Link to="/register">Sign up now</Link>
          </p>
        </div>
      </div>
    </div>
  );
}