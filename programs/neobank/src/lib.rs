use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer as transfer_sol, Transfer as TransferSol};
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{
        transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
    },
};

declare_id!("7Hrcju6Xgz6DPoyZSZLgeVjqbmxkcGSi2ZaXsL4KDN7C");

#[program]
pub mod neobank {
    use super::*;

    pub fn initialize_bank_account(context: Context<InitializeBankAccount>) -> Result<()> {
        context.accounts.bank_account.set_inner(BankAccount {
            owner: context.accounts.owner.key(),
            bump: context.bumps.bank_account,
            sol_balance: 0,
            token_mint: Pubkey::default(),
            token_balance: 0,
            token_vault_initialized: false,
        });

        Ok(())
    }

    pub fn deposit_sol(context: Context<DepositSol>, amount: u64) -> Result<()> {
        require!(amount > 0, ErrorCode::InvalidAmount);

        transfer_sol(
            CpiContext::new(
                context.accounts.system_program.to_account_info(),
                TransferSol {
                    from: context.accounts.owner.to_account_info(),
                    to: context.accounts.bank_account.to_account_info(),
                },
            ),
            amount,
        )?;

        context.accounts.bank_account.sol_balance = context
            .accounts
            .bank_account
            .sol_balance
            .checked_add(amount)
            .ok_or(ErrorCode::MathOverflow)?;

        Ok(())
    }

    pub fn withdraw_sol(context: Context<WithdrawSol>, amount: u64) -> Result<()> {
        require!(amount > 0, ErrorCode::InvalidAmount);
        require!(
            context.accounts.bank_account.sol_balance >= amount,
            ErrorCode::InsufficientSolBalance
        );

        // Program-owned accounts with data cannot be source of system transfer CPI.
        // Withdraw by mutating lamports directly.
        **context
            .accounts
            .bank_account
            .to_account_info()
            .try_borrow_mut_lamports()? = context
            .accounts
            .bank_account
            .to_account_info()
            .lamports()
            .checked_sub(amount)
            .ok_or(ErrorCode::MathOverflow)?;

        **context
            .accounts
            .owner
            .to_account_info()
            .try_borrow_mut_lamports()? = context
            .accounts
            .owner
            .to_account_info()
            .lamports()
            .checked_add(amount)
            .ok_or(ErrorCode::MathOverflow)?;

        context.accounts.bank_account.sol_balance = context
            .accounts
            .bank_account
            .sol_balance
            .checked_sub(amount)
            .ok_or(ErrorCode::MathOverflow)?;

        Ok(())
    }

    pub fn configure_token_vault(context: Context<ConfigureTokenVault>) -> Result<()> {
        if context.accounts.bank_account.token_vault_initialized {
            require!(
                context.accounts.bank_account.token_mint == context.accounts.token_mint.key(),
                ErrorCode::TokenMintImmutable
            );
        } else {
            context.accounts.bank_account.token_mint = context.accounts.token_mint.key();
            context.accounts.bank_account.token_vault_initialized = true;
        }

        Ok(())
    }

    pub fn deposit_spl(context: Context<DepositSpl>, amount: u64) -> Result<()> {
        require!(amount > 0, ErrorCode::InvalidAmount);
        require!(
            context.accounts.bank_account.token_vault_initialized,
            ErrorCode::TokenVaultNotInitialized
        );

        transfer_checked(
            CpiContext::new(
                context.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: context.accounts.owner_token_account.to_account_info(),
                    mint: context.accounts.token_mint.to_account_info(),
                    to: context.accounts.token_vault.to_account_info(),
                    authority: context.accounts.owner.to_account_info(),
                },
            ),
            amount,
            context.accounts.token_mint.decimals,
        )?;

        context.accounts.bank_account.token_balance = context
            .accounts
            .bank_account
            .token_balance
            .checked_add(amount)
            .ok_or(ErrorCode::MathOverflow)?;

        Ok(())
    }

    pub fn withdraw_spl(context: Context<WithdrawSpl>, amount: u64) -> Result<()> {
        require!(amount > 0, ErrorCode::InvalidAmount);
        require!(
            context.accounts.bank_account.token_vault_initialized,
            ErrorCode::TokenVaultNotInitialized
        );
        require!(
            context.accounts.bank_account.token_balance >= amount,
            ErrorCode::InsufficientTokenBalance
        );

        let owner_key = context.accounts.owner.key();
        let signer_seeds: &[&[u8]] = &[
            b"bank",
            owner_key.as_ref(),
            &[context.accounts.bank_account.bump],
        ];

        transfer_checked(
            CpiContext::new_with_signer(
                context.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: context.accounts.token_vault.to_account_info(),
                    mint: context.accounts.token_mint.to_account_info(),
                    to: context.accounts.owner_token_account.to_account_info(),
                    authority: context.accounts.bank_account.to_account_info(),
                },
                &[signer_seeds],
            ),
            amount,
            context.accounts.token_mint.decimals,
        )?;

        context.accounts.bank_account.token_balance = context
            .accounts
            .bank_account
            .token_balance
            .checked_sub(amount)
            .ok_or(ErrorCode::MathOverflow)?;

        Ok(())
    }

    pub fn close_bank_account(_context: Context<CloseBankAccount>) -> Result<()> {
        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeBankAccount<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        init,
        payer = owner,
        space = 8 + BankAccount::INIT_SPACE,
        seeds = [b"bank", owner.key().as_ref()],
        bump,
    )]
    pub bank_account: Account<'info, BankAccount>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DepositSol<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        has_one = owner,
        seeds = [b"bank", owner.key().as_ref()],
        bump = bank_account.bump,
    )]
    pub bank_account: Account<'info, BankAccount>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct WithdrawSol<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        has_one = owner,
        seeds = [b"bank", owner.key().as_ref()],
        bump = bank_account.bump,
    )]
    pub bank_account: Account<'info, BankAccount>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ConfigureTokenVault<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        has_one = owner,
        seeds = [b"bank", owner.key().as_ref()],
        bump = bank_account.bump,
    )]
    pub bank_account: Account<'info, BankAccount>,

    pub token_mint: InterfaceAccount<'info, Mint>,

    #[account(
        init_if_needed,
        payer = owner,
        associated_token::mint = token_mint,
        associated_token::authority = bank_account,
        associated_token::token_program = token_program,
    )]
    pub token_vault: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DepositSpl<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        has_one = owner,
        seeds = [b"bank", owner.key().as_ref()],
        bump = bank_account.bump,
        constraint = bank_account.token_mint == token_mint.key() @ ErrorCode::TokenMintMismatch,
    )]
    pub bank_account: Account<'info, BankAccount>,

    pub token_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = owner,
        associated_token::token_program = token_program,
    )]
    pub owner_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = bank_account,
        associated_token::token_program = token_program,
    )]
    pub token_vault: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct WithdrawSpl<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        has_one = owner,
        seeds = [b"bank", owner.key().as_ref()],
        bump = bank_account.bump,
        constraint = bank_account.token_mint == token_mint.key() @ ErrorCode::TokenMintMismatch,
    )]
    pub bank_account: Account<'info, BankAccount>,

    pub token_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = owner,
        associated_token::token_program = token_program,
    )]
    pub owner_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = bank_account,
        associated_token::token_program = token_program,
    )]
    pub token_vault: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct CloseBankAccount<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        has_one = owner,
        seeds = [b"bank", owner.key().as_ref()],
        bump = bank_account.bump,
        close = owner,
        constraint = bank_account.sol_balance == 0 @ ErrorCode::NonZeroSolBalance,
        constraint = bank_account.token_balance == 0 @ ErrorCode::NonZeroTokenBalance,
    )]
    pub bank_account: Account<'info, BankAccount>,
}

#[account]
#[derive(InitSpace)]
pub struct BankAccount {
    pub owner: Pubkey,
    pub bump: u8,
    pub sol_balance: u64,
    pub token_mint: Pubkey,
    pub token_balance: u64,
    pub token_vault_initialized: bool,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Amount must be greater than zero")]
    InvalidAmount,

    #[msg("Insufficient SOL balance")]
    InsufficientSolBalance,

    #[msg("Insufficient SPL token balance")]
    InsufficientTokenBalance,

    #[msg("Token vault not initialized")]
    TokenVaultNotInitialized,

    #[msg("Token mint does not match configured mint")]
    TokenMintMismatch,

    #[msg("Token mint cannot be changed after initial configuration")]
    TokenMintImmutable,

    #[msg("Cannot close account while SOL balance is non-zero")]
    NonZeroSolBalance,

    #[msg("Cannot close account while SPL balance is non-zero")]
    NonZeroTokenBalance,

    #[msg("Math overflow")]
    MathOverflow,
}
