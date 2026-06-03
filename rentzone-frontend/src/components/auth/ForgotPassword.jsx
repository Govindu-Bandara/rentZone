import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { authAPI } from '../../services/api';

export default function ForgotPassword() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess(false);

    if (!email) {
      setError('Please enter your email address.');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setError('Please enter a valid email address.');
      return;
    }

    setLoading(true);
    try {
      await authAPI.forgotPassword(email);
      setSuccess(true);
    } catch (err) {
      const msg = err?.response?.data?.error || err?.data?.error || 'Failed to send reset link. Please try again.';
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
          <h1 className="auth-hero-title">Reset Your Password</h1>
          <p className="auth-hero-subtitle">
            Don't worry! Enter your email and we'll send you a link to reset your password.
          </p>
          <div className="auth-hero-features">
            <div className="auth-hero-feature">
              <div className="auth-hero-feature-dot" />
              Reset link expires in 15 minutes
            </div>
            <div className="auth-hero-feature">
              <div className="auth-hero-feature-dot" />
              Check your spam folder
            </div>
            <div className="auth-hero-feature">
              <div className="auth-hero-feature-dot" />
              Secure password reset process
            </div>
          </div>
        </div>
      </div>

      {/* Form Panel */}
      <div className="auth-panel">
        <div className="auth-form-container">
          <div className="auth-form-header">
            <div style={{
              width: 64, height: 64, borderRadius: '50%',
              background: 'linear-gradient(135deg,#2563EB,#14B8A6)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 16px'
            }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
            </div>
            <h2 className="auth-form-title">Forgot Password?</h2>
            <p className="auth-form-subtitle">
              Enter your registered email address
            </p>
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

          {success ? (
            <div style={{ textAlign: 'center' }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '16px', borderRadius: 10, marginBottom: 24,
                background: '#ECFDF5', color: '#065F46',
                border: '1px solid #A7F3D0'
              }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
                <span>If an account exists with <strong>{email}</strong>, you'll receive a password reset link shortly.</span>
              </div>
              <button
                onClick={() => navigate('/login')}
                className="btn btn-primary btn-lg btn-full"
              >
                Return to Login
              </button>
            </div>
          ) : (
            <form className="auth-form" onSubmit={handleSubmit}>
              <div className="form-group">
                <label className="form-label required">Email Address</label>
                <div className="input-wrapper">
                  <span className="input-icon">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                      <polyline points="22,6 12,13 2,6"/>
                    </svg>
                  </span>
                  <input
                    type="email"
                    className="form-input has-icon"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoFocus
                    disabled={loading}
                  />
                </div>
              </div>

              <button
                type="submit"
                className={`btn btn-primary btn-lg btn-full${loading ? ' btn-loading' : ''}`}
                disabled={loading}
              >
                {!loading && (
                  <>
                    Send Reset Link
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <line x1="5" y1="12" x2="19" y2="12"/>
                      <polyline points="12 5 19 12 12 19"/>
                    </svg>
                  </>
                )}
              </button>
            </form>
          )}

          <p className="auth-form-footer" style={{ marginTop: 20 }}>
            Remember your password? <Link to="/login">Back to Login</Link>
          </p>
        </div>
      </div>
    </div>
  );
}