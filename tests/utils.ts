// Taken from Hedgehog/hedgehog-programs, with some modifications.
// TODO: Replace with common library.
import BN, { isBN } from 'bn.js';
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
import type { Idl } from '@project-serum/anchor';

type IdlErrorCode = NonNullable<Idl['errors']>[number];

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
  [K in E[number]['name']]: (E[number] & { name: K })['code'];
};

export function parseErrorCodes<E extends IdlErrorCode[]>(
  errors: E
): Readonly<ErrorCode<E>> {
  const map = {} as ErrorCode<E>;
  for (const { name, code } of errors) {
    map[name as keyof ErrorCode<E>] = code;
  }
  return Object.freeze(map);
}

export type IntoBigInt = bigint | number | boolean | string | BN;

export class IntoBigIntError extends TypeError {
  constructor(public value: IntoBigInt) {
    super('invalid value for conversion to big int');
    this.value = value;
  }
}

function bigIntToBN(n: bigint): BN {
  const neg = n < 0n;
  if (neg) {
    n = -n;
  }

  const len = Math.ceil(n.toString(16).length / 2);
  const buf = Buffer.alloc(len);

  let offset = 0;
  while (n > 0n) {
    offset = buf.writeUInt8(Number(n & 0xffn), offset);
    n >>= 8n;
  }

  const bn = new BN(buf, 'le');
  return neg ? bn.ineg() : bn;
}

export function intoBN(n: IntoBigInt): BN {
  switch (typeof n) {
    case 'bigint':
      return bigIntToBN(n);

    case 'number':
      // Check the value is an integer.
      if (!Number.isInteger(n)) {
        throw new IntoBigIntError(n);
      }

      return new BN(n);

    case 'boolean':
      return new BN(n ? 1 : 0);

    case 'string':
      try {
        return bigIntToBN(BigInt(n));
      } catch (e) {
        // The value isn't a valid bigint.
        throw new IntoBigIntError(n);
      }

    default:
      if (isBN(n)) {
        return n;
      }

      // Should never occur, if type constraints are followed.
      throw new IntoBigIntError(n);
  }
}
