import { AlertTriangle, ChevronDown, Code2, ExternalLink, LogOut, WalletCards, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { BOT_CHAIN, shortAddress, useEvmWallet } from "../lib/evm";

const appLinks = [
  { to: "/voters", label: "Voters" },
  { to: "/creators", label: "Creators" },
  { to: "/agents", label: "Agents" },
  { to: "/results", label: "Results" },
  { to: "/proof", label: "Proof" },
  { to: "/docs", label: "Docs" }
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const [isVisible, setIsVisible] = useState(true);
  const [lastScrollY, setLastScrollY] = useState(0);
  const [showDisconnect, setShowDisconnect] = useState(false);
  const wallet = useEvmWallet();
  const location = useLocation();
  const isHome = location.pathname === "/";

  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      setIsVisible(currentScrollY < 10 || currentScrollY <= lastScrollY || currentScrollY <= 100);
      setLastScrollY(currentScrollY);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [lastScrollY]);

  useEffect(() => {
    setShowDisconnect(false);
    setIsVisible(true);
    window.scrollTo({ top: 0, left: 0 });
  }, [location.pathname]);

  return (
    <div className={`app-shell ${isHome ? "home-route" : "app-route"}`}>
      <header className={`topbar ${!isVisible ? "hidden" : ""}`}>
        <div className="topbar-inner">
          <Link to="/" className="brand-link" aria-label="CipherBallot home">
            <span className="brand-mark" aria-hidden="true">
              <img src="/brand/cipherballot-mark.png" alt="" />
            </span>
            <span>CipherBallot</span>
          </Link>

          <nav className="nav-pill" aria-label="Primary navigation">
            {appLinks.map((item) => (
              <NavLink key={item.to} to={item.to}>{item.label}</NavLink>
            ))}
          </nav>

          <div className="nav-actions">
            {wallet.connected && wallet.chainId !== BOT_CHAIN.chainId ? (
              <button
                className="shell-wallet-button"
                onClick={() => void wallet.switchToBotChain()}
                disabled={wallet.switchingNetwork}
                aria-busy={wallet.switchingNetwork}
                aria-label="Switch to BOT Chain Testnet"
              >
                <WalletCards size={16} />
                <span>{wallet.switchingNetwork ? "Switching..." : "Switch network"}</span>
              </button>
            ) : wallet.connected ? (
              <div className="wallet-menu">
                <button className="shell-wallet-button" onClick={() => setShowDisconnect((visible) => !visible)} aria-expanded={showDisconnect}>
                  <span className="wallet-status-dot" />
                  <span>{shortAddress(wallet.account)}</span>
                  <ChevronDown size={14} />
                </button>
                {showDisconnect && (
                  <div className="wallet-dropdown">
                    <button onClick={() => { wallet.disconnect(); setShowDisconnect(false); }}>
                      <LogOut size={15} />
                      Disconnect
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <button className="shell-wallet-button shell-wallet-primary" onClick={() => wallet.connect()} disabled={wallet.connecting}>
                <WalletCards size={16} />
                <span>{wallet.connecting ? "Connecting..." : "Connect wallet"}</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {wallet.networkError && (
        <div className="network-alert" role="alert">
          <AlertTriangle size={17} aria-hidden="true" />
          <span>{wallet.networkError}</span>
          <button type="button" onClick={wallet.clearNetworkError} aria-label="Dismiss network error">
            <X size={16} />
          </button>
        </div>
      )}

      <main className={isHome ? "main-home" : undefined}>{children}</main>

      <footer className="site-footer">
        <div className="site-footer-inner">
          <div className="site-footer-brand">
            <Link to="/" className="brand-link">
              <span className="brand-mark" aria-hidden="true">
                <img src="/brand/cipherballot-mark.png" alt="" />
              </span>
              <span>CipherBallot</span>
            </Link>
            <p>Agent-native private governance on BOT Chain. Encrypt ballots, delegate scoped authority, and verify final decisions on-chain.</p>
          </div>

          <div className="site-footer-column">
            <strong>Product</strong>
            <Link to="/voters">Explore proposals</Link>
            <Link to="/creators">Create proposal</Link>
            <Link to="/agents">Agent access</Link>
            <Link to="/results">Results</Link>
          </div>

          <div className="site-footer-column">
            <strong>Protocol</strong>
            <Link to="/proof">BOT Chain proof</Link>
            <Link to="/docs">Documentation</Link>
            <a href="https://dev-docs.botchain.ai/docs/Developers/quick-guide/" target="_blank" rel="noopener noreferrer">
              BOT Chain docs <ExternalLink size={13} />
            </a>
            <a href="https://github.com/Ololadestephen/CipherBallot" target="_blank" rel="noopener noreferrer">
              GitHub <Code2 size={13} />
            </a>
          </div>
        </div>
        <div className="site-footer-bottom">© 2026 CipherBallot.</div>
      </footer>
    </div>
  );
}
