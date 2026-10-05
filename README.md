# Nuvex Fair Launch

**Solana Devnet fair-launch MVP for the Colosseum hackathon.**

Nuvex makes token-launch allocation rules explicit, deterministic and auditable.

## Live MVP

- Solana Devnet SPL mint creation
- Phantom-compatible wallet connection
- Allocation percentages with a 100% guardrail
- Wallet cap calculated against the public pool
- Deterministic capped-pro-rata allocation preview
- SHA-256 launch-policy commitment
- Solana Memo on-chain proof
- Direct verification of the proof against the confirmed Devnet transaction
- Mint and transaction Explorer links

## Anchor enforcement layer

The repository also includes the Anchor source for:

`create_launch → deposit_pool → request → finalize → claim`

The program uses PDAs for the launch, vault authority and participant records and performs capped pro-rata allocation on-chain.

**Important:** the Anchor program source is included as a reviewable artifact. It was not deployed by the hosted web environment used for the MVP. The live browser demonstration is the Devnet SPL mint + policy commitment + verification flow.

## Run locally

```bash
npm install
npm run dev
```

Open the Vite URL in a browser with Phantom installed and switched to Solana Devnet.

## Build

```bash
npm run build
```

## Repository structure

- `src/` — React/Vite MVP
- `anchor/` — Anchor fair-launch enforcement program
- `tests/` — MVP QA scenarios
- `ONCHAIN_ARCHITECTURE.md` — protocol and trust model

## Demo flow

1. Configure a launch.
2. Keep allocation at exactly 100%.
3. Connect Phantom on Devnet.
4. Launch and sign.
5. Open **Allocation Proof**.
6. Show the SHA-256 commitment.
7. Click **Verify on-chain**.
8. Open the Solana Explorer transaction.

Devnet SOL and tokens have no real monetary value.
