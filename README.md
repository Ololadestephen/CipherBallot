# CipherBallot (Arcium + Solana)


A confidential governance system where votes are cast and tallied inside Arcium’s encrypted shared state, and only the final, proof-backed results are published to Solana.

---

## 🚀 Innovation & Impact
**The Problem**: DAO governance suffers when votes are observable before the tally. "Herd mentality" biases early voters, and whale watching discourages honest participation.
**The Solution**: CipherBallot utilizes Arcium's validatable MPC (Multi-Party Computation) to create a "Dark DAO" voting mechanism.
-   **True Privacy**: Votes are encrypted client-side and *never* decrypted until the poll ends.
-   **Trustless Tally**: The tally is computed inside Arcium's TEE network. No single node sees individual votes.
-   **Public Verification**: The final result is accompanied by a cryptographic proof on Solana, ensuring the tally matches the encrypted inputs.

## 🛠 Technical Implementation
This project demonstrates a full-stack integration of Arcium with Solana Anchor.

### Key Components
1.  **Encrypted Instructions (`encrypted-ixs/`)**:
    -   `init_tally`: Initializes a zeroed encrypted integer in Arcium state.
    -   `apply_vote`: Homomorphically adds an encrypted vote (0 or 1) to the tally.
    -   `reveal_tally`: Decrypts the final sum *only* if the voting period has ended.
2.  **Solana Program (`programs/confidential_vote`)**:
    -   Acts as the orchestrator and data availability layer.
    -   Stores `ComputationDefinition` addresses and validates Arcium proofs.
    -   Enforces eligibility (whitelist/token-gating) before allowing an encrypted vote packet.
3.  **Frontend (`app/`)**:
    -   **Client-Side Encryption**: Uses `@arcium-hq/client` to encrypt user intent before it leaves the browser.
    -   **Hybrid Flow**: Coordinates standard Solana transactions (for eligibility) with Arcium instructions (for privacy).

### How Arcium is Used
1.  **Setup**: A creator defines a proposal. The app calls `init_computation` to spawn a dedicated generic MPC cluster for this vote.
2.  **Voting**:
    -   User selects "Yes/No".
    -   App generates a subtle random nonce and encrypts the input with the Cluster's public key.
    -   The encrypted payload is sent to Solana, which forwards it to Arcium nodes.
3.  **Tallying**: Arcium nodes blindly process the `apply_vote` instruction, updating the encrypted state.
4.  **Reveal**: Once the deadline passes, `reveal_tally` is triggered. The network cooperatively decrypts the result and posts it to the Anchor program account.

## Requirements
-   Rust 1.70+
-   Solana CLI 1.17+
-   Anchor CLI 0.29+
-   Node.js 18+
-   Arcium CLI 0.8.0

## Setup & Deployment
### 1. Install Dependencies
```bash
npm install
cd app && npm install
```

### 2. Build & Deploy
```bash
# Build encrypted instructions
arcium build

# Build Anchor program
anchor build

# Deploy to Devnet
anchor deploy
```

### 3. Run Frontend
```bash
cd app
npm run dev
# Open http://localhost:5173
```
*Note: Ensure `VITE_ARCIUM_CLUSTER_OFFSET` is set in `.env` based on your deployed cluster.*

## 📄 License
MIT

