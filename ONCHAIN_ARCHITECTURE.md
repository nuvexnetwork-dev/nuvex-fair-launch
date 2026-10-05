# Nuvex Fair Launch — on-chain enforcement

The repository contains the Anchor enforcement layer for the Nuvex Fair Launch MVP.

## Lifecycle

1. `create_launch` stores the public pool, wallet cap and policy hash.
2. `deposit_pool` moves exactly the configured public pool into a PDA-controlled vault.
3. `request` creates one participant PDA per wallet and adds `min(request, cap)` to capped demand.
4. `finalize` freezes participation after the vault is funded.
5. `claim` computes deterministic capped pro-rata allocation and transfers from the vault.

If total capped demand is below the public pool, a participant receives their full capped request. If demand exceeds the pool:

`allocation = capped_request * public_pool / total_capped_demand`

The multiplication uses `u128` before reducing to token units.

## Current deployment status

The browser MVP is live on Solana Devnet and demonstrates SPL mint creation, wallet signing, SHA-256 policy commitments, Memo proofs, and direct transaction verification.

The Anchor source is included for review and the next deployment step. It has **not** been deployed from the hosted AppDeploy environment. Do not represent the candidate program ID as a deployed program.
