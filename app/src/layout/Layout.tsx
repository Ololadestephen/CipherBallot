import { AlertTriangle, ChevronDown, Code2, ExternalLink, LogOut, Moon, MoreHorizontal, Sun, WalletCards, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { BOT_CHAIN, shortAddress, useEvmWallet } from "../lib/evm";
import { useTheme } from "../lib/theme";

const primaryLinks = [
  { to: "/voters", label: "Vote" },
  { to: "/creators", label: "Create" },
  { to: "/agents", label: "Agents" },
  { to: "/results", label: "Results" }
];

const moreLinks = [
  { to: "/proof", label: "Proof" },
  { to: "/docs", label: "Docs" }
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const [isVisible, setIsVisible] = useState(true);
  const [lastScrollY, setLastScrollY] = useState(0);
  const [showDisconnect, setShowDisconnect] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const moreRef = useRef<HTMLDivElement | null>(null);
  const moreButtonRef = useRef<HTMLButtonElement | null>(null);
  const wallet = useEvmWallet();
  const { theme, toggleTheme } = useTheme();
  const location = useLocation();
  const isHome = location.pathname === "/";
  const moreActive = moreLinks.some((item) => location.pathname === item.to || location.pathname.startsWith(`${item.to}/`));

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
    setShowMore(false);
    setIsVisible(true);
    window.scrollTo({ top: 0, left: 0 });
  }, [location.pathname]);

  useEffect(() => {
    if (!showMore) return;
    const onPointerDown = (event: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(event.target as Node)) {
        setShowMore(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowMore(false);
        moreButtonRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [showMore]);

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
            {primaryLinks.map((item) => (
              <NavLink key={item.to} to={item.to}>{item.label}</NavLink>
            ))}
            <div className="nav-more" ref={moreRef}>
              <button
                type="button"
                ref={moreButtonRef}
                className={`nav-more-trigger ${moreActive ? "active" : ""}`}
                aria-expanded={showMore}
                aria-haspopup="menu"
                aria-controls="more-navigation-menu"
                onClick={() => setShowMore((open) => !open)}
              >
                <MoreHorizontal size={15} aria-hidden="true" />
                <span>More</span>
                <ChevronDown size={13} aria-hidden="true" />
              </button>
              {showMore && (
                <div id="more-navigation-menu" className="nav-more-menu">
                  {moreLinks.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      onClick={() => setShowMore(false)}
                    >
                      {item.label}
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          </nav>

          <div className="nav-actions">
            <button
              type="button"
              className="theme-toggle"
              onClick={toggleTheme}
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
              title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            >
              {theme === "dark" ? <Sun size={17} aria-hidden="true" /> : <Moon size={17} aria-hidden="true" />}
            </button>
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
