// Taken from Hedgehog/hedgehog-programs, with some modifications.
// TODO: Replace with common library.
import type {
  Connection,
  PublicKey,
  TransactionInstruction,
} from '@solana/web3.js';

import { SystemProgram } from '@solana/web3.js';
import {
  MINT_SIZE,
  getMinimumBalanceForRentExemptMint,
  createInitializeMintInstruction,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import type { IdlErrorCode } from '@project-serum/anchor/dist/cjs/idl';

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
      TOKEN_PROGRAM_ID
    ),
  ];
}

type ErrorCode<E extends IdlErrorCode[]> = {
  [K in E[number]["name"]]: (E[number] & { name: K })["code"];
};

export function parseErrorCodes<E extends IdlErrorCode[]>(
  errors: E,
  ): Readonly<ErrorCode<E>> {
  const map = {} as ErrorCode<E>;
  for (const { name, code } of errors) {
      map[name as keyof ErrorCode<E>] = code;
  }
  return Object.freeze(map);
  }
