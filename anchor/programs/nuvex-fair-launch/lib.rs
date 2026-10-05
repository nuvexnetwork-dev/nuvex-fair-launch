use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, Token, TokenAccount, TransferChecked},
};

declare_id!("4S92Ldnxea8FbFW3f2BaofVfqMDUbjScoq5Ks7tdKp19");
const BPS_DENOMINATOR: u64 = 10_000;

#[program]
pub mod nuvex_fair_launch {
    use super::*;

    pub fn create_launch(ctx: Context<CreateLaunch>, public_pool: u64, wallet_cap_bps: u64, policy_hash: [u8; 32]) -> Result<()> {
        require!(public_pool > 0, ErrorCode::InvalidPool);
        require!(wallet_cap_bps > 0 && wallet_cap_bps <= BPS_DENOMINATOR, ErrorCode::InvalidCap);
        let l = &mut ctx.accounts.launch;
        l.admin = ctx.accounts.admin.key();
        l.mint = ctx.accounts.mint.key();
        l.public_pool = public_pool;
        l.wallet_cap_bps = wallet_cap_bps;
        l.total_capped_demand = 0;
        l.total_claimed = 0;
        l.policy_hash = policy_hash;
        l.finalized = false;
        l.bump = ctx.bumps.launch;
        l.vault_bump = ctx.bumps.vault_authority;
        Ok(())
    }

    pub fn deposit_pool(ctx: Context<DepositPool>, amount: u64) -> Result<()> {
        require!(!ctx.accounts.launch.finalized, ErrorCode::AlreadyFinalized);
        require!(ctx.accounts.vault.amount == 0, ErrorCode::PoolAlreadyFunded);
        require!(amount == ctx.accounts.launch.public_pool, ErrorCode::PoolMismatch);
        let cpi_accounts = TransferChecked {
            from: ctx.accounts.admin_token.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
            to: ctx.accounts.vault.to_account_info(),
            authority: ctx.accounts.admin.to_account_info(),
        };
        token::transfer_checked(CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts), amount, ctx.accounts.mint.decimals)?;
        Ok(())
    }

    pub fn request(ctx: Context<Request>, amount: u64) -> Result<()> {
        let launch = &mut ctx.accounts.launch;
        require!(!launch.finalized, ErrorCode::AlreadyFinalized);
        require!(amount > 0, ErrorCode::InvalidRequest);
        let capped = amount.min(cap_for(launch.public_pool, launch.wallet_cap_bps)?);
        launch.total_capped_demand = launch.total_capped_demand.checked_add(capped).ok_or(ErrorCode::MathOverflow)?;
        let p = &mut ctx.accounts.participant;
        p.launch = launch.key();
        p.wallet = ctx.accounts.user.key();
        p.requested = amount;
        p.claimed = false;
        p.bump = ctx.bumps.participant;
        Ok(())
    }

    pub fn finalize(ctx: Context<Finalize>) -> Result<()> {
        let l = &mut ctx.accounts.launch;
        require!(!l.finalized, ErrorCode::AlreadyFinalized);
        require!(l.total_capped_demand > 0, ErrorCode::NoDemand);
        require!(ctx.accounts.vault.amount >= l.public_pool, ErrorCode::PoolNotFunded);
        l.finalized = true;
        Ok(())
    }

    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        let l = &mut ctx.accounts.launch;
        let p = &mut ctx.accounts.participant;
        require!(l.finalized, ErrorCode::NotFinalized);
        require!(!p.claimed, ErrorCode::AlreadyClaimed);
        require!(p.launch == l.key() && p.wallet == ctx.accounts.user.key(), ErrorCode::InvalidParticipant);
        let capped = p.requested.min(cap_for(l.public_pool, l.wallet_cap_bps)?);
        let amount = if l.total_capped_demand <= l.public_pool {
            capped
        } else {
            ((capped as u128).checked_mul(l.public_pool as u128).ok_or(ErrorCode::MathOverflow)? / l.total_capped_demand as u128) as u64
        };
        require!(amount > 0, ErrorCode::ZeroAllocation);
        require!(amount <= ctx.accounts.vault.amount, ErrorCode::InsufficientVault);
        let key = l.key();
        let seeds: &[&[u8]] = &[b"vault-authority", key.as_ref(), &[l.vault_bump]];
        let cpi_accounts = TransferChecked {
            from: ctx.accounts.vault.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
            to: ctx.accounts.user_token.to_account_info(),
            authority: ctx.accounts.vault_authority.to_account_info(),
        };
        token::transfer_checked(CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), cpi_accounts, &[seeds]), amount, ctx.accounts.mint.decimals)?;
        p.claimed = true;
        l.total_claimed = l.total_claimed.checked_add(amount).ok_or(ErrorCode::MathOverflow)?;
        Ok(())
    }
}

fn cap_for(pool: u64, bps: u64) -> Result<u64> {
    ((pool as u128).checked_mul(bps as u128).ok_or(ErrorCode::MathOverflow)? / BPS_DENOMINATOR as u128).try_into().map_err(|_| ErrorCode::MathOverflow.into())
}

#[derive(Accounts)]
pub struct CreateLaunch<'info> {
    #[account(mut)] pub admin: Signer<'info>,
    pub mint: Account<'info, Mint>,
    #[account(init, payer=admin, space=8+Launch::LEN, seeds=[b"launch",admin.key().as_ref(),mint.key().as_ref()], bump)]
    pub launch: Account<'info, Launch>,
    /// CHECK: PDA is only the authority for the vault ATA.
    #[account(seeds=[b"vault-authority",launch.key().as_ref()], bump)]
    pub vault_authority: UncheckedAccount<'info>,
    #[account(init, payer=admin, associated_token::mint=mint, associated_token::authority=vault_authority)]
    pub vault: Account<'info, TokenAccount>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[derive(Accounts)]
pub struct DepositPool<'info> {
    #[account(mut, has_one=admin, has_one=mint)] pub launch: Account<'info, Launch>,
    pub admin: Signer<'info>,
    pub mint: Account<'info, Mint>,
    #[account(mut, token::mint=mint, token::authority=admin)] pub admin_token: Account<'info, TokenAccount>,
    #[account(mut, token::mint=mint, token::authority=vault_authority)] pub vault: Account<'info, TokenAccount>,
    /// CHECK: PDA authority.
    #[account(seeds=[b"vault-authority",launch.key().as_ref()], bump=launch.vault_bump)] pub vault_authority: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Request<'info> {
    #[account(mut)] pub launch: Account<'info, Launch>,
    #[account(init, payer=user, space=8+Participant::LEN, seeds=[b"participant",launch.key().as_ref(),user.key().as_ref()], bump)]
    pub participant: Account<'info, Participant>,
    #[account(mut)] pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Finalize<'info> {
    #[account(mut, has_one=admin)] pub launch: Account<'info, Launch>,
    pub admin: Signer<'info>,
    #[account(token::mint=launch.mint, token::authority=vault_authority)] pub vault: Account<'info, TokenAccount>,
    /// CHECK: PDA authority.
    #[account(seeds=[b"vault-authority",launch.key().as_ref()], bump=launch.vault_bump)] pub vault_authority: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut)] pub launch: Account<'info, Launch>,
    #[account(mut, seeds=[b"participant",launch.key().as_ref(),user.key().as_ref()], bump=participant.bump)] pub participant: Account<'info, Participant>,
    #[account(mut)] pub user: Signer<'info>,
    pub mint: Account<'info, Mint>,
    #[account(mut, token::mint=mint, token::authority=vault_authority)] pub vault: Account<'info, TokenAccount>,
    #[account(mut, token::mint=mint, token::authority=user)] pub user_token: Account<'info, TokenAccount>,
    /// CHECK: PDA authority.
    #[account(seeds=[b"vault-authority",launch.key().as_ref()], bump=launch.vault_bump)] pub vault_authority: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
}

#[account]
pub struct Launch {
    pub admin: Pubkey, pub mint: Pubkey, pub public_pool: u64, pub wallet_cap_bps: u64,
    pub total_capped_demand: u64, pub total_claimed: u64, pub policy_hash: [u8;32],
    pub finalized: bool, pub bump: u8, pub vault_bump: u8,
}
impl Launch { const LEN: usize = 32+32+8+8+8+8+32+1+1+1; }

#[account]
pub struct Participant { pub launch: Pubkey, pub wallet: Pubkey, pub requested: u64, pub claimed: bool, pub bump: u8 }
impl Participant { const LEN: usize = 32+32+8+1+1; }

#[error_code]
pub enum ErrorCode {
    #[msg("Invalid public pool")] InvalidPool,
    #[msg("Invalid wallet cap")] InvalidCap,
    #[msg("Launch already finalized")] AlreadyFinalized,
    #[msg("Pool amount mismatch")] PoolMismatch,
    #[msg("Invalid request")] InvalidRequest,
    #[msg("Math overflow")] MathOverflow,
    #[msg("No demand")] NoDemand,
    #[msg("Pool not funded")] PoolNotFunded,
    #[msg("Launch not finalized")] NotFinalized,
    #[msg("Invalid participant")] InvalidParticipant,
    #[msg("Already claimed")] AlreadyClaimed,
    #[msg("Zero allocation")] ZeroAllocation,
    #[msg("Insufficient vault balance")] InsufficientVault,
    #[msg("Pool already funded")] PoolAlreadyFunded,
}