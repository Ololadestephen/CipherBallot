import "./polyfills";
import React from "react";
import ReactDOM from "react-dom/client";
import { WalletAdapterNetwork } from "@solana/wallet-adapter-base";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter, SolflareWalletAdapter } from "@solana/wallet-adapter-wallets";
import { BrowserRouter } from "react-router-dom";
import { Buffer } from "buffer";
import App from "./App";
import "@solana/wallet-adapter-react-ui/styles.css";
import "./styles.css";

if (!(globalThis as any).Buffer) {
  (globalThis as any).Buffer = Buffer;
}

const network = WalletAdapterNetwork.Devnet;
const endpoint = import.meta.env.VITE_SOLANA_RPC_URL || "https://api.devnet.solana.com";
const wallets = [new PhantomWalletAdapter(), new SolflareWalletAdapter({ network })];

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  </React.StrictMode>
);
