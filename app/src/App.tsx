import { Analytics } from "@vercel/analytics/react";
import { Route, Routes } from "react-router-dom";
import Layout from "./layout/Layout";
import Home from "./pages/Home";
import Voters from "./pages/Voters";
import Creators from "./pages/Creators";
import Results from "./pages/Results";
import ProposalDetails from "./pages/ProposalDetails";
import Docs from "./pages/Docs";
import Proof from "./pages/Proof";
import NotFound from "./pages/NotFound";
import Agents from "./pages/Agents";
import CommitteePortal from "./pages/CommitteePortal";

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/voters" element={<Voters />} />
        <Route path="/creators" element={<Creators />} />
        <Route path="/agents" element={<Agents />} />
        <Route path="/committee/:code" element={<CommitteePortal />} />
        <Route path="/proposal/:id" element={<ProposalDetails />} />
        <Route path="/results" element={<Results />} />
        <Route path="/proof" element={<Proof />} />
        <Route path="/docs" element={<Docs />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
      <Analytics />
    </Layout>
  );
}
