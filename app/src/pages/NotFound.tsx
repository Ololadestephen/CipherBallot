import { ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <section className="not-found-page">
      <span>404</span>
      <h1>Page not found</h1>
      <p>The route does not exist in the CipherBallot application.</p>
      <Link className="cta icon-command" to="/"><ArrowLeft size={16} /> Return home</Link>
    </section>
  );
}
