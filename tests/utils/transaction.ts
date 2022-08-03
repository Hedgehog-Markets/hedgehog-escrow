import type { HhEscrow } from "../../target/types/hh_escrow";
import {
  PublicKey,
  SendTransactionError,
  Signer,
  TransactionInstruction,
} from "@solana/web3.js";
import type { IdlErrorCode } from "./idl";

import * as anchor from "@project-serum/anchor";

import { ProgramErrorStack } from "@project-serum/anchor";
import { Transaction } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

import { ESCROW_PROGRAM_ID, ESCROW_PROGRAM_IDL } from "./constants";
import { __throw } from "./misc";
import { spl } from "./spl";

const errors = new Map<string, Map<number, string>>();

function addErrors(programId: PublicKey, idlErrors: Array<IdlErrorCode>) {
  errors.set(
    programId.toBase58(),
    new Map(idlErrors.map(({ code, name, msg }) => [code, msg ?? name])),
  );
}

// Add SPL Token program errors.
addErrors(TOKEN_PROGRAM_ID, spl.idl.errors);
// Add SPL Associated Token program errors.
addErrors(ASSOCIATED_TOKEN_PROGRAM_ID, [
  {
    code: 0,
    name: "InvalidOwner",
    msg: "Associated token account owner does not match address derivation",
  },
]);

// Add anchor workspace program errors.
addErrors(ESCROW_PROGRAM_ID, ESCROW_PROGRAM_IDL.errors);

export async function sendTx(
  tx: Transaction | TransactionInstruction[],
  signers: Signer[] = [],
) {
  if (!(tx instanceof Transaction)) {
    tx = new Transaction().add(...tx);
  }

  const provider = anchor.getProvider();
  const connection = provider.connection;

  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash();

  tx.feePayer = provider.wallet.publicKey;
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;

  tx = await provider.wallet.signTransaction(tx);
  for (const signer of signers) {
    tx.partialSign(signer);
  }

  const rawTx = tx.serialize();

  let signature: string;
  try {
    signature = await connection.sendRawTransaction(rawTx);
  } catch (err) {
    if (err instanceof SendTransactionError && err.logs) {
      throw new ProgramError(err.message, err.logs);
    }
    throw err;
  }

  const status = (
    await connection.confirmTransaction({
      signature: signature,
      blockhash,
      lastValidBlockHeight,
    })
  ).value;
  if (!status.err) {
    return signature;
  }

  const err = `Transaction ${signature} failed (${JSON.stringify(status)})`;
  const logs =
    (
      await connection.getTransaction(signature, {
        commitment: "confirmed",
      })
    )?.meta?.logMessages ?? __throw(new ConfirmTransactionError(err));

  throw new ProgramError(err, logs);
}

export class ConfirmTransactionError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export class ProgramError extends SendTransactionError {
  public readonly programErrorStack: PublicKey[];

  constructor(message: string, override readonly logs: string[]) {
    super(message, logs);
    this.programErrorStack = ProgramErrorStack.parse(logs).stack;
  }

  get program(): PublicKey {
    return this.programErrorStack[this.programErrorStack.length - 1]!;
  }
}
