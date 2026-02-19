import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <section className="hero">
      <div className="hero-card">
        <span className="tag">404</span>
        <h2>Page not found</h2>
        <p>That page doesn't exist. Head back to the main dashboard.</p>
        <Link className="cta" to="/">
          Return home
        </Link>
      </div>
    </section>
  );
}
