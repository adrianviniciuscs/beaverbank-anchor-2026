import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
    createMint,
    getAssociatedTokenAddressSync,
    mintTo,
    TOKEN_PROGRAM_ID,
    createAssociatedTokenAccount,
    getAccount,
} from "@solana/spl-token";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import assert from "node:assert";

describe("neobank", () => {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const program = anchor.workspace.Neobank as Program;
    const owner = (provider.wallet as anchor.Wallet & { payer: Keypair }).payer;

    const [bankPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("bank"), owner.publicKey.toBuffer()],
        program.programId,
    );

    it("initializes account and handles SOL deposits/withdrawals", async () => {
        await program.methods
            .initializeBankAccount()
            .accounts({
                owner: owner.publicKey,
                bankAccount: bankPda,
                systemProgram: SystemProgram.programId,
            })
            .rpc();

        const depositAmount = new anchor.BN(100_000_000);
        await program.methods
            .depositSol(depositAmount)
            .accounts({
                owner: owner.publicKey,
                bankAccount: bankPda,
                systemProgram: SystemProgram.programId,
            })
            .rpc();

        let bankAccount = await (program.account as any).bankAccount.fetch(bankPda);
        assert.equal(bankAccount.solBalance.toString(), depositAmount.toString());

        const withdrawAmount = new anchor.BN(40_000_000);
        await program.methods
            .withdrawSol(withdrawAmount)
            .accounts({
                owner: owner.publicKey,
                bankAccount: bankPda,
                systemProgram: SystemProgram.programId,
            })
            .rpc();

        bankAccount = await (program.account as any).bankAccount.fetch(bankPda);
        assert.equal(bankAccount.solBalance.toString(), "60000000");
    });

    it("configures token vault and handles SPL deposits/withdrawals", async () => {
        const mint = await createMint(
            provider.connection,
            owner,
            owner.publicKey,
            null,
            6,
            undefined,
            undefined,
            TOKEN_PROGRAM_ID,
        );

        const ownerTokenAccount = await createAssociatedTokenAccount(
            provider.connection,
            owner,
            mint,
            owner.publicKey,
            undefined,
            TOKEN_PROGRAM_ID,
        );

        const tokenVault = getAssociatedTokenAddressSync(mint, bankPda, true, TOKEN_PROGRAM_ID);

        await mintTo(
            provider.connection,
            owner,
            mint,
            ownerTokenAccount,
            owner,
            10_000_000,
            [],
            undefined,
            TOKEN_PROGRAM_ID,
        );

        await program.methods
            .configureTokenVault()
            .accounts({
                owner: owner.publicKey,
                bankAccount: bankPda,
                tokenMint: mint,
                tokenVault,
                tokenProgram: TOKEN_PROGRAM_ID,
                associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
            })
            .rpc();

        await program.methods
            .depositSpl(new anchor.BN(3_000_000))
            .accounts({
                owner: owner.publicKey,
                bankAccount: bankPda,
                tokenMint: mint,
                ownerTokenAccount,
                tokenVault,
                tokenProgram: TOKEN_PROGRAM_ID,
            })
            .rpc();

        await program.methods
            .withdrawSpl(new anchor.BN(1_000_000))
            .accounts({
                owner: owner.publicKey,
                bankAccount: bankPda,
                tokenMint: mint,
                ownerTokenAccount,
                tokenVault,
                tokenProgram: TOKEN_PROGRAM_ID,
            })
            .rpc();

        const vaultAccount = await getAccount(provider.connection, tokenVault, undefined, TOKEN_PROGRAM_ID);
        assert.equal(vaultAccount.amount.toString(), "2000000");

        const bankAccount = await (program.account as any).bankAccount.fetch(bankPda);
        assert.equal(bankAccount.tokenBalance.toString(), "2000000");
    });
});
