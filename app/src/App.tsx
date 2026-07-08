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

const proposals = [
  {
    id: "#001",
    title: "Treasury Allocation Q2",
    status: "Active",
    endsIn: "2d 4h",
    votesCast: 128
  },
  {
    id: "#002",
    title: "Research Grant Program",
    status: "Upcoming",
    endsIn: "Starts in 6h",
    votesCast: 0
  },
  {
    id: "#003",
    title: "Validator Set Expansion",
    status: "Ended",
    endsIn: "Finalized",
    votesCast: 342
  }
];

const features = [
  {
    title: "Hidden vote commitments",
    detail: "Votes are committed as hashes during the active window, so interim option totals stay private."
  },
  {
    title: "Verifiable final tally",
    detail: "After the deadline, voters reveal their choices and the contract verifies every reveal."
  },
  {
    title: "Live participation metrics",
    detail: "Track total commitments without exposing live voting signals."
  }
];

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/voters" element={<Voters />} />
        <Route path="/creators" element={<Creators />} />
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
