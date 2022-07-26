import type {
    Connection,
    PublicKey,
    TransactionInstruction,
} from "@solana/web3.js";

import { SystemProgram } from "@solana/web3.js";
import {
    MINT_SIZE,
    TOKEN_PROGRAM_ID,
    createInitializeMintInstruction,
    getMinimumBalanceForRentExemptMint,
    getMinimumBalanceForRentExemptAccount,
    ACCOUNT_SIZE,
    createInitializeAccountInstruction,
} from "@solana/spl-token";

type CreateInitMintParams = {
    mint: PublicKey;
    mintAuthority: PublicKey;
    freezeAuthority?: PublicKey | undefined;

    decimals?: number | undefined;

    connection: Connection;
    payer: PublicKey;
};

export async function createInitMintInstructions({
    mint,
    mintAuthority,
    freezeAuthority,
    decimals,
    connection,
    payer,
}: CreateInitMintParams): Promise<
    [TransactionInstruction, TransactionInstruction]
> {
    payer = payer;
    decimals = decimals ?? 0;

    const lamports = await getMinimumBalanceForRentExemptMint(connection);

    return [
        SystemProgram.createAccount({
            fromPubkey: payer,
            newAccountPubkey: mint,
            space: MINT_SIZE,
            lamports,
            programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeMintInstruction(
            mint,
            decimals,
            mintAuthority,
            freezeAuthority ?? null,
            TOKEN_PROGRAM_ID,
        ),
    ];
}

type CreateInitAccountParams = {
    account: PublicKey;
    mint: PublicKey;
    user: PublicKey;
    connection: Connection;
    payer: PublicKey;
};

export async function createInitAccountInstructions({
    account,
    mint,
    user,
    connection,
    payer,
}: CreateInitAccountParams): Promise<
    [TransactionInstruction, TransactionInstruction]
> {
    const lamports = await getMinimumBalanceForRentExemptAccount(connection);

    return [
        SystemProgram.createAccount({
            fromPubkey: payer,
            newAccountPubkey: account,
            space: ACCOUNT_SIZE,
            lamports,
            programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeAccountInstruction(
            account,
            mint,
            user,
            TOKEN_PROGRAM_ID,
        ),
    ];
}
