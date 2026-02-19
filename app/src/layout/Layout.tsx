import { Link, NavLink } from "react-router-dom";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell">
      <header className="topbar glass-panel" style={{ borderBottom: '1px solid var(--stroke)' }}>
        <div className="brand">
          <Link to="/" className="brand-link">
            <span className="brand-mark">C</span>
            <span>CipherBallot</span>
          </Link>
        </div>
        <div className="nav-pill">
          <NavLink to="/" end>
            Explore
          </NavLink>
          <NavLink to="/voters">Voters</NavLink>
          <NavLink to="/creators">Creators</NavLink>
          <NavLink to="/results">Results</NavLink>
          <NavLink to="/docs">Docs</NavLink>
        </div>
        <div className="nav-actions">
          <WalletMultiButton className="cta" />
        </div>
      </header>
      <main>{children}</main>

      <footer className="footer glass-panel" style={{ marginTop: 'auto', borderTop: '1px solid var(--stroke)' }}>
        <div style={{ maxWidth: '1120px', margin: '0 auto', padding: '40px 24px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '40px' }}>

          {/* Brand Section */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div className="brand-link" style={{ fontSize: '20px' }}>
              <span className="brand-mark" style={{ width: '32px', height: '32px' }}>C</span>
              <span>CipherBallot</span>
            </div>
            <p style={{ color: 'var(--text-muted)', fontSize: '14px', lineHeight: '1.6', margin: 0 }}>
              Privacy-preserving governance on Solana. Powered by Arcium bindings for secure, encrypted, and fair voting execution.
            </p>
          </div>

          {/* Quick Links */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <h4 style={{ color: 'var(--text-primary)', fontSize: '14px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>App</h4>
            <Link to="/" style={{ color: 'var(--text-secondary)', fontSize: '14px', transition: 'color 0.2s' }} className="footer-link">Explore Proposals</Link>
            <Link to="/creators" style={{ color: 'var(--text-secondary)', fontSize: '14px', transition: 'color 0.2s' }} className="footer-link">Create Proposal</Link>
            <Link to="/voters" style={{ color: 'var(--text-secondary)', fontSize: '14px', transition: 'color 0.2s' }} className="footer-link">Voter Dashboard</Link>
            <Link to="/results" style={{ color: 'var(--text-secondary)', fontSize: '14px', transition: 'color 0.2s' }} className="footer-link">Results History</Link>
          </div>

          {/* Resources */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <h4 style={{ color: 'var(--text-primary)', fontSize: '14px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Resources</h4>
            <Link to="/docs" style={{ color: 'var(--text-secondary)', fontSize: '14px', transition: 'color 0.2s' }} className="footer-link">Documentation</Link>
            <a href="https://docs.arcium.com/" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text-secondary)', fontSize: '14px' }} className="footer-link">Arcium Docs</a>
            <a href="https://github.com/Ololadestephen/CipherBallot" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text-secondary)', fontSize: '14px' }} className="footer-link">GitHub</a>
          </div>

        </div>

        {/* Sub-footer */}
        <div style={{ borderTop: '1px solid var(--stroke)', padding: '24px', textAlign: 'center' }}>
          <p style={{ margin: 0, color: '#444', fontSize: '13px' }}>
            © 2026 CipherBallot.
          </p>
        </div>
      </footer>
    </div>
  );
}
