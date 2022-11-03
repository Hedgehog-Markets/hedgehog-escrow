import { inspect } from "util";

import {
  AnchorError,
  AnchorProvider,
  LangErrorMessage,
  ProgramErrorStack,
  getProvider,
  workspace,
} from "@project-serum/anchor";
import {
  Message,
  PACKET_DATA_SIZE,
  PublicKey,
  Transaction,
  SendTransactionError as Web3SendTransactionError,
} from "@solana/web3.js";

import { __throw } from "./misc";
import { atoken, spl } from "./spl";
import { system } from "./system";

import type { IdlErrorCode } from "./idl";
import type { Program } from "@project-serum/anchor";
import type { ConfirmOptions, Connection, Signer, TransactionInstruction } from "@solana/web3.js";

const errors = new Map<string, Map<number, string>>();

export function addErrors(programId: PublicKey, idlErrors: ReadonlyArray<IdlErrorCode>): void {
  const key = programId.toBase58();
  if (errors.has(key)) {
    throw new Error(`Already added errors for ${key}`);
  }
  errors.set(key, new Map(idlErrors.map(({ code, name, msg }) => [code, msg ?? name])));
}

export const mapTxErr = <T>(promise: Promise<T>): Promise<T> =>
  promise.catch((err) => {
    if (err instanceof Error) {
      let e: Error | undefined;

      if (err instanceof Web3SendTransactionError && err.logs) {
        if (err.logs.length > 0) {
          try {
            e = translateError(err.message, err.logs);
          } catch {
            // noop
          }
        }
      }

      const prefix = "failed to send transaction: ";
      if (e === undefined && err.message.startsWith(prefix)) {
        e = new Error(err.message.slice(prefix.length));
      }

      if (e !== undefined) {
        e.cause = err;

        if (e.stack && err.stack) {
          const lines1 = e.stack.split("\n").slice(0, 1);
          const lines2 = err.stack.split("\n").slice(1);
          e.stack = lines1.concat(lines2).join("\n");
        }

        throw e;
      }
    }

    throw err;
  });

addErrors(system.programId, system.idl.errors);
addErrors(spl.programId, spl.idl.errors);
addErrors(atoken.programId, atoken.idl.errors);

// Add errors for all programs in the Anchor workspace.
{
  workspace[0]; // Ensure Anchor has loaded the workspace.
  for (const program of Object.values<Program>(workspace)) {
    if (program.idl.errors) {
      addErrors(program.programId, program.idl.errors);
    }
  }
}

export function packInstructions(
  ixs: ReadonlyArray<TransactionInstruction | ReadonlyArray<TransactionInstruction>>,
  feePayer: PublicKey = PublicKey.default,
  blockhash: string = PublicKey.default.toBase58(),
): Array<Transaction> {
  const buildTx = (ixs: ReadonlyArray<TransactionInstruction>) => {
    const tx = new Transaction();
    tx.feePayer = feePayer;
    tx.recentBlockhash = blockhash;
    return ixs.length > 0 ? tx.add(...ixs) : tx;
  };

  const getTxSize = (tx: Transaction) => {
    const encodedLengthBytes = (len: number) => {
      let bytes = 0;
      let remLen = len;
      for (;;) {
        remLen >>= 7;
        bytes++;
        if (remLen === 0) {
          break;
        }
      }
      return bytes;
    };

    try {
      // Work around warning messages for transactions with no instructions.
      let message: Message;
      if (tx.instructions.length === 0) {
        message = new Message({
          header: {
            numRequiredSignatures: 1,
            numReadonlySignedAccounts: 0,
            numReadonlyUnsignedAccounts: 0,
          },
          accountKeys: [tx.feePayer ?? feePayer],
          recentBlockhash: tx.recentBlockhash ?? blockhash,
          instructions: [],
        });
      } else {
        message = tx.compileMessage();
      }

      {
        const signedKeys = message.accountKeys.slice(0, message.header.numRequiredSignatures);

        let valid = false;
        if (tx.signatures.length === signedKeys.length) {
          valid = tx.signatures.every((pair, index) => {
            return (signedKeys[index] as PublicKey).equals(pair.publicKey);
          });
        }

        if (!valid) {
          tx.signatures = signedKeys.map((publicKey) => ({
            signature: null,
            publicKey,
          }));
        }
      }

      return (
        message.serialize().byteLength +
        tx.signatures.length * 64 +
        encodedLengthBytes(tx.signatures.length)
      );
    } catch (_) {
      return Number.MAX_SAFE_INTEGER;
    }
  };

  const packed: Array<Transaction> = [];

  let currentTx = buildTx([]);
  for (const ixGroup of ixs) {
    const newTx = buildTx(Array.isArray(ixGroup) ? ixGroup : [ixGroup]);
    const txSize = getTxSize(newTx);
    if (PACKET_DATA_SIZE >= getTxSize(currentTx) + txSize) {
      // If `newTx` can be added to the current transaction, then do so.
      currentTx.add(...newTx.instructions);
    } else if (PACKET_DATA_SIZE <= txSize) {
      // If `newTx` is too large to fit in the transaction, then throw error.
      throw new Error("A grouping of instructions too large to fit in a single transaction");
    } else {
      // If `new` cannot be added to `currentTx`, push `currentTx` and move forward.
      packed.push(currentTx);
      currentTx = newTx;
    }
  }

  // If the final transaction has at least 1 instruction, add it to the pack.
  if (currentTx.instructions.length > 0) {
    packed.push(currentTx);
  }

  return packed;
}

export function signTransactions(
  txs: Array<Transaction>,
  signers: ReadonlyArray<Signer>,
): Array<Transaction> {
  const sigMap = new Map(signers.map((signer) => [signer.publicKey.toBase58(), signer]));

  // Sign transactions with the appropriate signers.
  for (const tx of txs) {
    const txSigners = [];

    // Collect appropriate signers for the transaction.
    for (const ix of tx.instructions) {
      for (const { isSigner, pubkey } of ix.keys) {
        if (isSigner) {
          const signer = sigMap.get(pubkey.toBase58());
          if (signer) {
            txSigners.push(signer);
          }
        }
      }
    }

    if (txSigners.length > 0) {
      tx.partialSign(...txSigners);
    }
  }

  return txs;
}

export async function sendTx(
  tx: Transaction | ReadonlyArray<TransactionInstruction>,
  signers: ReadonlyArray<Signer> = [],
  opts?: ConfirmOptions,
): Promise<string> {
  if (!(tx instanceof Transaction)) {
    tx = new Transaction().add(...tx);
  }

  const provider = getProvider();
  const connection = provider.connection;

  if (!opts) {
    if (provider instanceof AnchorProvider) {
      opts = provider.opts;
    } else {
      opts = AnchorProvider.defaultOptions();
    }
  }

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash(opts);

  tx.feePayer = provider.publicKey;
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;

  tx = await provider.wallet.signTransaction(tx);
  for (const signer of signers) {
    tx.partialSign(signer);
  }

  return sendAndConfirmTransaction(connection, tx, opts);
}

export async function sendAndConfirmTransaction(
  connection: Connection,
  tx: Transaction,
  opts?: ConfirmOptions,
): Promise<string> {
  const rawTx = tx.serialize();
  const signature = await mapTxErr(connection.sendRawTransaction(rawTx, opts));

  const { recentBlockhash: blockhash, lastValidBlockHeight } = tx;
  const { value: status } =
    blockhash != null && lastValidBlockHeight != null
      ? await connection.confirmTransaction(
          {
            signature,
            blockhash,
            lastValidBlockHeight,
          },
          opts?.commitment,
        )
      : await connection.confirmTransaction(signature, opts?.commitment);

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
    )?.meta?.logMessages ?? __throw(new ConfirmTransactionError(err));

  throw translateError(err, logs);
}

export class ConfirmTransactionError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export class SendTransactionError extends Error {
  constructor(
    message: string,
    readonly logs: ReadonlyArray<string>,
    readonly programErrorStack: ReadonlyArray<PublicKey>,
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

export class ProgramError extends SendTransactionError {
  constructor(
    message: string,
    logs: ReadonlyArray<string>,
    programErrorStack: ReadonlyArray<PublicKey>,
    readonly code: number,
  ) {
    super(message, logs, programErrorStack);
  }
}

export function translateError(
  message: string,
  logs: Array<string>,
): Error & {
  readonly logs: ReadonlyArray<string>;
  readonly programErrorStack: ReadonlyArray<PublicKey>;
  readonly program: PublicKey;
} {
  // Parse anchor error.
  const anchorError = AnchorError.parse(logs);
  if (anchorError) {
    return anchorError;
  }

  const programErrorStack = ProgramErrorStack.parse(logs).stack;
  const program =
    programErrorStack[programErrorStack.length - 1] ??
    __throw(
      new Error(
        `Failed to parse error stack, can't find program in logs: ${inspect({ message, logs })}`,
      ),
    );

  const errorCodeRegex = /^Program \w+ failed: custom program error: (.*)$/;

  let unparsedErrorCode: string | undefined = undefined;
  for (const entry of logs) {
    const match = errorCodeRegex.exec(entry)?.[1];
    if (match) {
      unparsedErrorCode = match;
      break;
    }
  }

  if (!unparsedErrorCode) {
    return new SendTransactionError(message, logs, programErrorStack);
  }

  let errorCode: number;
  try {
    // eslint-disable-next-line radix
    errorCode = parseInt(unparsedErrorCode);
  } catch (parseErr) {
    return new SendTransactionError(message, logs, programErrorStack);
  }

  const programErrors = errors.get(program.toBase58());
  if (!programErrors) {
    return new SendTransactionError(message, logs, programErrorStack);
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
  return new SendTransactionError(message, logs, programErrorStack);
}
