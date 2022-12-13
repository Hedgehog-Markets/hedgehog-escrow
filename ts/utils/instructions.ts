import { getProvider } from "@project-serum/anchor";
import {
  ACCOUNT_SIZE,
  MINT_SIZE,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TokenInvalidAccountOwnerError,
  createAssociatedTokenAccountIdempotentInstruction as _createAssociatedTokenAccountIdempotentInstruction,
  createAssociatedTokenAccountInstruction as _createAssociatedTokenAccountInstruction,
  createInitializeAccount3Instruction,
  createInitializeMint2Instruction,
  getAccountLenForMint,
  getMinimumBalanceForRentExemptMint,
  unpackMint,
} from "@solana/spl-token";
import { SystemProgram } from "@solana/web3.js";

import { translateAddress } from "./accounts";

import type { Address } from "./accounts";
import type { PublicKey, TransactionInstruction } from "@solana/web3.js";

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
  const { connection, wallet } = getProvider();

  payer = translateAddress(payer) ?? wallet.publicKey;

  mint = translateAddress(mint);
  mintAuthority = translateAddress(mintAuthority);

  const lamports = await getMinimumBalanceForRentExemptMint(connection);

  return [
    SystemProgram.createAccount({
      fromPubkey: payer,
      newAccountPubkey: mint,
      space: MINT_SIZE,
      lamports,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMint2Instruction(
      mint,
      decimals ?? 0,
      mintAuthority,
      freezeAuthority != null ? translateAddress(freezeAuthority) : null,
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
  const { connection, wallet } = getProvider();

  payer = translateAddress(payer) ?? wallet.publicKey;

  account = translateAddress(account);
  mint = translateAddress(mint);
  user = translateAddress(user);

  let programId: PublicKey;
  let space: number;

  // If the mint already exists, then we should adapt to the correct token program.
  const mintInfo = await connection.getAccountInfo(mint);
  if (mintInfo) {
    programId = mintInfo.owner;
    if (!(programId.equals(TOKEN_PROGRAM_ID) || programId.equals(TOKEN_2022_PROGRAM_ID))) {
      throw new TokenInvalidAccountOwnerError(
        `Account '${mint}' (mint) is owned by '${programId}'`,
      );
    }

    const mintState = unpackMint(mint, mintInfo, programId);
    space = getAccountLenForMint(mintState);
  } else {
    programId = TOKEN_PROGRAM_ID;
    space = ACCOUNT_SIZE;
  }

  return [
    SystemProgram.createAccount({
      fromPubkey: payer,
      newAccountPubkey: account,
      space,
      lamports: await connection.getMinimumBalanceForRentExemption(space),
      programId,
    }),
    createInitializeAccount3Instruction(account, mint, user, programId),
  ];
}

type CreateAssociatedTokenAccountParams = {
  account: Address;
  owner: Address;
  mint: Address;

  payer?: Address | undefined;
  programId?: Address | undefined;
};

export function createAssociatedTokenAccountInstruction({
  account,
  owner,
  mint,
  payer,
  programId,
}: CreateAssociatedTokenAccountParams): TransactionInstruction {
  return _createAssociatedTokenAccountInstruction(
    translateAddress(payer) ?? getProvider().wallet.publicKey,
    translateAddress(account),
    translateAddress(owner),
    translateAddress(mint),
    translateAddress(programId),
  );
}

export function createAssociatedTokenAccountIdempotentInstruction({
  account,
  owner,
  mint,
  payer,
  programId,
}: CreateAssociatedTokenAccountParams): TransactionInstruction {
  return _createAssociatedTokenAccountIdempotentInstruction(
    translateAddress(payer) ?? getProvider().wallet.publicKey,
    translateAddress(account),
    translateAddress(owner),
    translateAddress(mint),
    translateAddress(programId),
  );
}
