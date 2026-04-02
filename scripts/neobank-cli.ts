import * as anchor from "@coral-xyz/anchor";
import type { Idl } from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
    getAssociatedTokenAddressSync,
    TOKEN_PROGRAM_ID,
    getAccount,
} from "@solana/spl-token";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import idl from "../target/idl/neobank.json";

const color = {
    green: "\x1b[32m",
    cyan: "\x1b[36m",
    yellow: "\x1b[33m",
    red: "\x1b[31m",
    reset: "\x1b[0m",
};

function info(message: string) {
    console.log(`${color.cyan}${message}${color.reset}`);
}

function ok(message: string) {
    console.log(`${color.green}${message}${color.reset}`);
}

function warn(message: string) {
    console.log(`${color.yellow}${message}${color.reset}`);
}

function fail(message: string) {
    console.error(`${color.red}${message}${color.reset}`);
}

function help() {
    console.log(`
BeaverBank CLI

Usage:
    npm run beaverbank -- init
    npm run beaverbank -- balance
    npm run beaverbank -- deposit-sol <lamports>
    npm run beaverbank -- withdraw-sol <lamports>
    npm run beaverbank -- configure-mint <mintPubkey>
    npm run beaverbank -- deposit-spl <amountRaw>
    npm run beaverbank -- withdraw-spl <amountRaw>
`);
}

async function main() {
    if (!process.env.ANCHOR_WALLET && process.env.HOME) {
        process.env.ANCHOR_WALLET = `${process.env.HOME}/.config/solana/id.json`;
    }

    if (!process.env.ANCHOR_PROVIDER_URL) {
        process.env.ANCHOR_PROVIDER_URL = "http://127.0.0.1:8899";
    }

    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const program = new Program(idl as Idl, provider) as Program;
    const owner = provider.publicKey;
    const [bankPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("bank"), owner.toBuffer()],
        program.programId,
    );

    const command = process.argv[2];
    const valueArg = process.argv[3];

    if (!command || command === "help" || command === "--help" || command === "-h") {
        help();
        return;
    }

    if (command === "init") {
        await program.methods
            .initializeBankAccount()
            .accounts({
                owner,
                bankAccount: bankPda,
                systemProgram: SystemProgram.programId,
            })
            .rpc();
        ok(`Bank account initialized: ${bankPda.toBase58()}`);
        return;
    }

    if (command === "balance") {
        const bank = await (program.account as any).bankAccount.fetchNullable(bankPda);
        if (!bank) {
            warn("Bank account not initialized yet. Run: npm run cli -- init");
            return;
        }

        info(`Owner: ${bank.owner.toBase58()}`);
        info(`Bank PDA: ${bankPda.toBase58()}`);
        info(`SOL balance (tracked lamports): ${bank.solBalance.toString()}`);
        info(`Token vault initialized: ${bank.tokenVaultInitialized}`);

        if (bank.tokenVaultInitialized) {
            const mint = new PublicKey(bank.tokenMint);
            const vault = getAssociatedTokenAddressSync(mint, bankPda, true, TOKEN_PROGRAM_ID);
            const vaultAccount = await getAccount(provider.connection, vault, undefined, TOKEN_PROGRAM_ID);
            info(`Token mint: ${mint.toBase58()}`);
            info(`Token balance (tracked raw): ${bank.tokenBalance.toString()}`);
            info(`Vault token balance (raw): ${vaultAccount.amount.toString()}`);
        }

        return;
    }

    if (command === "deposit-sol" || command === "withdraw-sol") {
        if (!valueArg) {
            throw new Error("Missing amount in lamports");
        }

        const amount = new anchor.BN(valueArg);
        const method = command === "deposit-sol" ? program.methods.depositSol(amount) : program.methods.withdrawSol(amount);

        await method
            .accounts({
                owner,
                bankAccount: bankPda,
                systemProgram: SystemProgram.programId,
            })
            .rpc();

        ok(`${command} executed with ${valueArg} lamports`);
        return;
    }

    if (command === "configure-mint") {
        if (!valueArg) {
            throw new Error("Missing mint public key");
        }

        const mint = new PublicKey(valueArg);
        const vault = getAssociatedTokenAddressSync(mint, bankPda, true, TOKEN_PROGRAM_ID);

        await program.methods
            .configureTokenVault()
            .accounts({
                owner,
                bankAccount: bankPda,
                tokenMint: mint,
                tokenVault: vault,
                tokenProgram: TOKEN_PROGRAM_ID,
                associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
            })
            .rpc();

        ok(`Token vault configured for mint ${mint.toBase58()}`);
        return;
    }

    if (command === "deposit-spl" || command === "withdraw-spl") {
        if (!valueArg) {
            throw new Error("Missing raw token amount");
        }

        const bank = await (program.account as any).bankAccount.fetch(bankPda);
        if (!bank.tokenVaultInitialized) {
            throw new Error("Token vault not configured. Run configure-mint first.");
        }

        const mint = new PublicKey(bank.tokenMint);
        const ownerTokenAccount = getAssociatedTokenAddressSync(mint, owner, false, TOKEN_PROGRAM_ID);
        const tokenVault = getAssociatedTokenAddressSync(mint, bankPda, true, TOKEN_PROGRAM_ID);
        const amount = new anchor.BN(valueArg);

        const method =
            command === "deposit-spl" ? program.methods.depositSpl(amount) : program.methods.withdrawSpl(amount);

        await method
            .accounts({
                owner,
                bankAccount: bankPda,
                tokenMint: mint,
                ownerTokenAccount,
                tokenVault,
                tokenProgram: TOKEN_PROGRAM_ID,
            })
            .rpc();

        ok(`${command} executed with ${valueArg} raw units`);
        return;
    }

    help();
    throw new Error(`Unknown command: ${command}`);
}

main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    fail(message);
    process.exit(1);
});
