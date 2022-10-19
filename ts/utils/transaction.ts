import {
  AnchorError,
  LangErrorMessage,
  ProgramErrorStack,
  getProvider,
  workspace,
} from "@project-serum/anchor";
import { SendTransactionError, Transaction } from "@solana/web3.js";

import { __throw } from "./misc";
import { atoken, spl } from "./spl";
import { system } from "./system";

import type { IdlErrorCode } from "./idl";
import type { Program } from "@project-serum/anchor";
import type { PublicKey, Signer, TransactionInstruction } from "@solana/web3.js";

const errors = new Map<string, Map<number, string>>();

function addErrors(programId: PublicKey, idlErrors: Array<IdlErrorCode>) {
  errors.set(
    programId.toBase58(),
    new Map(idlErrors.map(({ code, name, msg }) => [code, msg ?? name])),
  );
}

addErrors(system.programId, system.idl.errors);
addErrors(spl.programId, spl.idl.errors);
addErrors(atoken.programId, atoken.idl.errors);

{
  workspace[0]; // Ensure anchor has loaded the workspace.
  for (const program of Object.values<Program>(workspace)) {
    if (program.idl.errors) {
      addErrors(program.programId, program.idl.errors);
    }
  }
}

export async function sendTx(
  tx: Transaction | Array<TransactionInstruction>,
  signers: Array<Signer> = [],
): Promise<string> {
  if (!(tx instanceof Transaction)) {
    tx = new Transaction().add(...tx);
  }

  const provider = getProvider();
  const connection = provider.connection;

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();

  tx.feePayer = provider.publicKey;
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
      throw translateError(err.message, err.logs);
    }
    throw err;
  }

  const status = (
    await connection.confirmTransaction({
      signature,
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
        maxSupportedTransactionVersion: 0,
      })
    )?.meta?.logMessages ?? __throw(new ConfirmTxError(err));

  throw translateError(err, logs);
}

export class ConfirmTxError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export class SendTxError extends Error {
  constructor(
    message: string,
    readonly logs: Array<string>,
    readonly programErrorStack: Array<PublicKey>,
  ) {
    super(message);
  }

  get program(): PublicKey {
    return (
      this.programErrorStack[this.programErrorStack.length - 1] ??
      __throw(new Error("Missing program"))
    );
  }
}

export class ProgramError extends SendTxError {
  constructor(
    message: string,
    logs: Array<string>,
    programErrorStack: Array<PublicKey>,
    readonly code: number,
  ) {
    super(message, logs, programErrorStack);
  }
}

export function translateError(
  message: string,
  logs: Array<string>,
): Error & {
  readonly logs: Array<string>;
  readonly programErrorStack: Array<PublicKey>;
  readonly program: PublicKey;
} {
  // Parse anchor error.
  const anchorError = AnchorError.parse(logs);
  if (anchorError) {
    return anchorError;
  }

  const programErrorStack = ProgramErrorStack.parse(logs).stack;
  const program =
    programErrorStack[programErrorStack.length - 1] ?? __throw(new Error("Missing program"));

  const errorCodeRegex = /^Program \w+ failed: custom program error: (.*)$/;

  let unparsedErrorCode: string | undefined = undefined;
  for (const entry of logs) {
    const match = entry.match(errorCodeRegex)?.[1];
    if (match) {
      unparsedErrorCode = match;
      break;
    }
  }

  if (!unparsedErrorCode) {
    return new SendTxError(message, logs, programErrorStack);
  }

  let errorCode: number;
  try {
    // eslint-disable-next-line radix
    errorCode = parseInt(unparsedErrorCode);
  } catch (parseErr) {
    return new SendTxError(message, logs, programErrorStack);
  }

  const programErrors = errors.get(program.toBase58());
  if (!programErrors) {
    return new SendTxError(message, logs, programErrorStack);
  }

  // Parse user error.
  let errorMsg = programErrors.get(errorCode);
  if (errorMsg !== undefined) {
    return new ProgramError(errorMsg, logs, programErrorStack, errorCode);
  }

  // Parse basic anchor program error.
  errorMsg = LangErrorMessage.get(errorCode);
  if (errorMsg !== undefined) {
    return new ProgramError(errorMsg, logs, programErrorStack, errorCode);
  }

  // Unable to parse the error code.
  return new SendTxError(message, logs, programErrorStack);
}

export const mapTxErr = <T>(promise: Promise<T>): Promise<T> =>
  promise.catch((err) => {
    if (err instanceof SendTransactionError && err.logs) {
      const e = translateError(err.message, err.logs);
      e.cause = err;
      if (e.stack && err.stack) {
        const lines1 = e.stack.split("\n").slice(0, 1);
        const lines2 = err.stack.split("\n").slice(1);
        e.stack = lines1.concat(lines2).join("\n");
      }
      throw e;
    }
    throw err;
  });
