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
import { Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
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

    it("rejects reconfiguration with a different mint", async () => {
        const isolatedOwner = Keypair.generate();
        const airdropSig = await provider.connection.requestAirdrop(isolatedOwner.publicKey, LAMPORTS_PER_SOL);
        await provider.connection.confirmTransaction(airdropSig, "confirmed");

        const [isolatedBankPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("bank"), isolatedOwner.publicKey.toBuffer()],
            program.programId,
        );

        await program.methods
            .initializeBankAccount()
            .accounts({
                owner: isolatedOwner.publicKey,
                bankAccount: isolatedBankPda,
                systemProgram: SystemProgram.programId,
            })
            .signers([isolatedOwner])
            .rpc();

        const mintA = await createMint(
            provider.connection,
            owner,
            owner.publicKey,
            null,
            6,
            undefined,
            undefined,
            TOKEN_PROGRAM_ID,
        );

        const mintB = await createMint(
            provider.connection,
            owner,
            owner.publicKey,
            null,
            6,
            undefined,
            undefined,
            TOKEN_PROGRAM_ID,
        );

        const tokenVaultA = getAssociatedTokenAddressSync(mintA, isolatedBankPda, true, TOKEN_PROGRAM_ID);
        const tokenVaultB = getAssociatedTokenAddressSync(mintB, isolatedBankPda, true, TOKEN_PROGRAM_ID);

        await program.methods
            .configureTokenVault()
            .accounts({
                owner: isolatedOwner.publicKey,
                bankAccount: isolatedBankPda,
                tokenMint: mintA,
                tokenVault: tokenVaultA,
                tokenProgram: TOKEN_PROGRAM_ID,
                associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
            })
            .signers([isolatedOwner])
            .rpc();

        let rejected = false;
        try {
            await program.methods
                .configureTokenVault()
                .accounts({
                    owner: isolatedOwner.publicKey,
                    bankAccount: isolatedBankPda,
                    tokenMint: mintB,
                    tokenVault: tokenVaultB,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                })
                .signers([isolatedOwner])
                .rpc();
        } catch (_error) {
            rejected = true;
        }

        assert.equal(rejected, true, "changing mint after initial configuration must fail");
    });

    it("closes bank account only when balances are zero", async () => {
        const isolatedOwner = Keypair.generate();
        const airdropSig = await provider.connection.requestAirdrop(isolatedOwner.publicKey, LAMPORTS_PER_SOL);
        await provider.connection.confirmTransaction(airdropSig, "confirmed");

        const [closePda] = PublicKey.findProgramAddressSync(
            [Buffer.from("bank"), isolatedOwner.publicKey.toBuffer()],
            program.programId,
        );

        await program.methods
            .initializeBankAccount()
            .accounts({
                owner: isolatedOwner.publicKey,
                bankAccount: closePda,
                systemProgram: SystemProgram.programId,
            })
            .signers([isolatedOwner])
            .rpc();

        await program.methods
            .depositSol(new anchor.BN(10_000_000))
            .accounts({
                owner: isolatedOwner.publicKey,
                bankAccount: closePda,
                systemProgram: SystemProgram.programId,
            })
            .signers([isolatedOwner])
            .rpc();

        let closeRejected = false;
        try {
            await program.methods
                .closeBankAccount()
                .accounts({
                    owner: isolatedOwner.publicKey,
                    bankAccount: closePda,
                })
                .signers([isolatedOwner])
                .rpc();
        } catch (_error) {
            closeRejected = true;
        }

        assert.equal(closeRejected, true, "closing must fail while there is SOL in the bank account");

        await program.methods
            .withdrawSol(new anchor.BN(10_000_000))
            .accounts({
                owner: isolatedOwner.publicKey,
                bankAccount: closePda,
                systemProgram: SystemProgram.programId,
            })
            .signers([isolatedOwner])
            .rpc();

        await program.methods
            .closeBankAccount()
            .accounts({
                owner: isolatedOwner.publicKey,
                bankAccount: closePda,
            })
            .signers([isolatedOwner])
            .rpc();

        const closed = await provider.connection.getAccountInfo(closePda);
        assert.equal(closed, null, "bank account should be closed and deallocated");
    });

    it("rejects non-owner access", async () => {
        const ownerA = Keypair.generate();
        const attacker = Keypair.generate();

        const airdropOwner = await provider.connection.requestAirdrop(ownerA.publicKey, LAMPORTS_PER_SOL);
        await provider.connection.confirmTransaction(airdropOwner, "confirmed");

        const airdropAttacker = await provider.connection.requestAirdrop(attacker.publicKey, LAMPORTS_PER_SOL);
        await provider.connection.confirmTransaction(airdropAttacker, "confirmed");

        const [bankPdaA] = PublicKey.findProgramAddressSync(
            [Buffer.from("bank"), ownerA.publicKey.toBuffer()],
            program.programId,
        );

        await program.methods
            .initializeBankAccount()
            .accounts({
                owner: ownerA.publicKey,
                bankAccount: bankPdaA,
                systemProgram: SystemProgram.programId,
            })
            .signers([ownerA])
            .rpc();

        await program.methods
            .depositSol(new anchor.BN(10_000_000))
            .accounts({
                owner: ownerA.publicKey,
                bankAccount: bankPdaA,
                systemProgram: SystemProgram.programId,
            })
            .signers([ownerA])
            .rpc();

        let rejected = false;
        try {
            await program.methods
                .withdrawSol(new anchor.BN(1_000_000))
                .accounts({
                    owner: attacker.publicKey,
                    bankAccount: bankPdaA,
                    systemProgram: SystemProgram.programId,
                })
                .signers([attacker])
                .rpc();
        } catch (_error) {
            rejected = true;
        }

        assert.equal(rejected, true, "non-owner must not be able to operate another bank account");
    });
});
