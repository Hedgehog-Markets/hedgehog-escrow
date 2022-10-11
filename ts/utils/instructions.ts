import { getProvider } from "@project-serum/anchor";
import {
  ACCOUNT_SIZE,
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction as _createAssociatedTokenAccountInstruction,
  createInitializeAccountInstruction,
  createInitializeMintInstruction,
  getMinimumBalanceForRentExemptAccount,
  getMinimumBalanceForRentExemptMint,
} from "@solana/spl-token";
import { SystemProgram } from "@solana/web3.js";

import { translateAddress } from "./accounts";
import { opt } from "./misc";

import type { Address } from "./accounts";
import type { TransactionInstruction } from "@solana/web3.js";

type CreateInitMintParams = {
  mint: Address;
  mintAuthority: Address;
  freezeAuthority?: Address | undefined;
  decimals?: number | undefined;

  payer?: Address | undefined;
};

export async function createInitMintInstructions({
  mint,
  mintAuthority,
  freezeAuthority,
  decimals,
  payer,
}: CreateInitMintParams): Promise<[TransactionInstruction, TransactionInstruction]> {
  const provider = getProvider();
  const connection = provider.connection;

  payer = opt(payer).apply(translateAddress).value ?? provider.wallet.publicKey;

  const lamports = await getMinimumBalanceForRentExemptMint(connection);

  return [
    SystemProgram.createAccount({
      fromPubkey: payer,
      newAccountPubkey: translateAddress(mint),
      space: MINT_SIZE,
      lamports,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMintInstruction(
      translateAddress(mint),
      decimals ?? 0,
      translateAddress(mintAuthority),
      opt(freezeAuthority).apply(translateAddress).value ?? null,
      TOKEN_PROGRAM_ID,
    ),
  ];
}

type CreateInitAccountParams = {
  account: Address;
  mint: Address;
  user: Address;

  payer?: Address | undefined;
};

export async function createInitAccountInstructions({
  account,
  mint,
  user,
  payer,
}: CreateInitAccountParams): Promise<[TransactionInstruction, TransactionInstruction]> {
  const provider = getProvider();
  const connection = provider.connection;

  payer = opt(payer).apply(translateAddress).value ?? provider.wallet.publicKey;

  const lamports = await getMinimumBalanceForRentExemptAccount(connection);

  return [
    SystemProgram.createAccount({
      fromPubkey: payer,
      newAccountPubkey: translateAddress(account),
      space: ACCOUNT_SIZE,
      lamports,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeAccountInstruction(
      translateAddress(account),
      translateAddress(mint),
      translateAddress(user),
      TOKEN_PROGRAM_ID,
    ),
  ];
}

type CreateAssociatedTokenAccountParams = {
  account: Address;
  owner: Address;
  mint: Address;

  payer?: Address | undefined;
};

export function createAssociatedTokenAccountInstruction({
  account,
  owner,
  mint,
  payer,
}: CreateAssociatedTokenAccountParams): TransactionInstruction {
  payer = opt(payer).apply(translateAddress).value ?? getProvider().wallet.publicKey;

  return _createAssociatedTokenAccountInstruction(
    payer,
    translateAddress(account),
    translateAddress(owner),
    translateAddress(mint),
  );
}
