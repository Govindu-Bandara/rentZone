const Footer = () => {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <div className="footer-grid">
          <div>
            <div className="footer-brand-logo">
              <img src="/logo.png" alt="Rent Zone" style={{ width: 34, height: 34 }} />
              <span className="footer-brand-name">Rent Zone</span>
            </div>
            <p className="footer-tagline">Your trusted rental platform</p>
          </div>
          <div>
            <div className="footer-col-title">Company</div>
            <div className="footer-col-links">
              <a href="#">About Us</a>
              <a href="#">Careers</a>
              <a href="#">Press</a>
            </div>
          </div>
          <div>
            <div className="footer-col-title">Support</div>
            <div className="footer-col-links">
              <a href="#">Help Center</a>
              <a href="#">Contact Us</a>
              <a href="#">Terms</a>
            </div>
          </div>
          <div>
            <div className="footer-col-title">Legal</div>
            <div className="footer-col-links">
              <a href="#">Terms of Service</a>
              <a href="#">Privacy Policy</a>
              <a href="#">Cookie Policy</a>
            </div>
          </div>
        </div>
        <div className="footer-bottom">
          © {new Date().getFullYear()} Rent Zone. All rights reserved.
        </div>
      </div>
    </footer>
  );
};

export default Footer;