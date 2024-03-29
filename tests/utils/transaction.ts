// TODO: Improve this.

import {
  PublicKey,
  SendTransactionError,
  Signer,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import type { IdlErrorCode } from "./idl";

import * as anchor from "@project-serum/anchor";

import {
  AnchorError,
  LangErrorCode,
  ProgramErrorStack,
} from "@project-serum/anchor";
import { Transaction } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

import { ESCROW_PROGRAM_ID, ESCROW_PROGRAM_IDL } from "./constants";
import { __throw } from "./misc";
import { spl } from "./spl";

import { parseErrorCodes } from "./idl";

type SystemProgramErrors = [
  {
    code: 0;
    name: "AccountAlreadyInUse";
    msg: "an account with the same address already exists";
  },
  {
    code: 1;
    name: "ResultWithNegativeLamports";
    msg: "account does not have enough SOL to perform the operation";
  },
  {
    code: 2;
    name: "InvalidProgramId";
    msg: "cannot assign account to this program id";
  },
  {
    code: 3;
    name: "InvalidAccountDataLength";
    msg: "cannot allocate account data of this length";
  },
  {
    code: 4;
    name: "MaxSeedLengthExceeded";
    msg: "length of requested seed is too long";
  },
  {
    code: 5;
    name: "AddressWithSeedMismatch";
    msg: "provided address does not match addressed derived from seed";
  },
  {
    code: 6;
    name: "NonceNoRecentBlockhashes";
    msg: "advancing stored nonce requires a populated RecentBlockhashes sysvar";
  },
  {
    code: 7;
    name: "NonceBlockhashNotExpired";
    msg: "stored nonce is still in recent_blockhashes";
  },
  {
    code: 8;
    name: "NonceUnexpectedBlockhashValue";
    msg: "specified nonce does not match stored nonce";
  },
];

const systemProgramErrors: SystemProgramErrors = [
  {
    code: 0,
    name: "AccountAlreadyInUse",
    msg: "an account with the same address already exists",
  },
  {
    code: 1,
    name: "ResultWithNegativeLamports",
    msg: "account does not have enough SOL to perform the operation",
  },
  {
    code: 2,
    name: "InvalidProgramId",
    msg: "cannot assign account to this program id",
  },
  {
    code: 3,
    name: "InvalidAccountDataLength",
    msg: "cannot allocate account data of this length",
  },
  {
    code: 4,
    name: "MaxSeedLengthExceeded",
    msg: "length of requested seed is too long",
  },
  {
    code: 5,
    name: "AddressWithSeedMismatch",
    msg: "provided address does not match addressed derived from seed",
  },
  {
    code: 6,
    name: "NonceNoRecentBlockhashes",
    msg: "advancing stored nonce requires a populated RecentBlockhashes sysvar",
  },
  {
    code: 7,
    name: "NonceBlockhashNotExpired",
    msg: "stored nonce is still in recent_blockhashes",
  },
  {
    code: 8,
    name: "NonceUnexpectedBlockhashValue",
    msg: "specified nonce does not match stored nonce",
  },
];

export const SystemErrorCode = parseErrorCodes(systemProgramErrors);

type ATokenErrors = [
  {
    code: 0;
    name: "InvalidOwner";
    msg: "Associated token account owner does not match address derivation";
  },
];

const aTokenErrors: ATokenErrors = [
  {
    code: 0,
    name: "InvalidOwner",
    msg: "Associated token account owner does not match address derivation",
  },
];

export const ATokenErrorCode = parseErrorCodes(aTokenErrors);

const errors = new Map<string, Map<number, string>>();

function addErrors(programId: PublicKey, idlErrors: Array<IdlErrorCode>) {
  errors.set(
    programId.toBase58(),
    new Map(idlErrors.map(({ code, name, msg }) => [code, msg ?? name])),
  );
}

// Add Solana system program errors.
addErrors(SystemProgram.programId, systemProgramErrors);

// Add SPL Token program errors.
addErrors(TOKEN_PROGRAM_ID, spl.idl.errors);
// Add SPL Associated Token program errors.
addErrors(ASSOCIATED_TOKEN_PROGRAM_ID, aTokenErrors);

// Add anchor workspace program errors.
addErrors(ESCROW_PROGRAM_ID, ESCROW_PROGRAM_IDL.errors);

export async function sendTx(
  tx: Transaction | TransactionInstruction[],
  signers: Signer[] = [],
): Promise<string> {
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
      throw translateError(err.message, err.logs);
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
    readonly logs: string[],
    readonly programErrorStack: PublicKey[],
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
    logs: string[],
    programErrorStack: PublicKey[],
    readonly code: number,
  ) {
    super(message, logs, programErrorStack);
  }
}

function translateError(
  message: string,
  logs: string[],
): Error & {
  readonly logs: string[];
  readonly programErrorStack: PublicKey[];
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
    __throw(new Error("Missing program"));

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
  errorMsg = anchorErrors.get(errorCode);
  if (errorMsg !== undefined) {
    return new ProgramError(errorMsg, logs, programErrorStack, errorCode);
  }

  // Unable to parse the error code.
  return new SendTxError(message, logs, programErrorStack);
}

const anchorErrors = new Map([
  // Instructions.
  [
    LangErrorCode.InstructionMissing,
    "8 byte instruction identifier not provided",
  ],
  [
    LangErrorCode.InstructionFallbackNotFound,
    "Fallback functions are not supported",
  ],
  [
    LangErrorCode.InstructionDidNotDeserialize,
    "The program could not deserialize the given instruction",
  ],
  [
    LangErrorCode.InstructionDidNotSerialize,
    "The program could not serialize the given instruction",
  ],

  // Idl instructions.
  [
    LangErrorCode.IdlInstructionStub,
    "The program was compiled without idl instructions",
  ],
  [
    LangErrorCode.IdlInstructionInvalidProgram,
    "The transaction was given an invalid program for the IDL instruction",
  ],

  // Constraints.
  [LangErrorCode.ConstraintMut, "A mut constraint was violated"],
  [LangErrorCode.ConstraintHasOne, "A has_one constraint was violated"],
  [LangErrorCode.ConstraintSigner, "A signer constraint was violated"],
  [LangErrorCode.ConstraintRaw, "A raw constraint was violated"],
  [LangErrorCode.ConstraintOwner, "An owner constraint was violated"],
  [
    LangErrorCode.ConstraintRentExempt,
    "A rent exemption constraint was violated",
  ],
  [LangErrorCode.ConstraintSeeds, "A seeds constraint was violated"],
  [LangErrorCode.ConstraintExecutable, "An executable constraint was violated"],
  [LangErrorCode.ConstraintState, "A state constraint was violated"],
  [LangErrorCode.ConstraintAssociated, "An associated constraint was violated"],
  [
    LangErrorCode.ConstraintAssociatedInit,
    "An associated init constraint was violated",
  ],
  [LangErrorCode.ConstraintClose, "A close constraint was violated"],
  [LangErrorCode.ConstraintAddress, "An address constraint was violated"],
  [LangErrorCode.ConstraintZero, "Expected zero account discriminant"],
  [LangErrorCode.ConstraintTokenMint, "A token mint constraint was violated"],
  [LangErrorCode.ConstraintTokenOwner, "A token owner constraint was violated"],
  [
    LangErrorCode.ConstraintMintMintAuthority,
    "A mint mint authority constraint was violated",
  ],
  [
    LangErrorCode.ConstraintMintFreezeAuthority,
    "A mint freeze authority constraint was violated",
  ],
  [
    LangErrorCode.ConstraintMintDecimals,
    "A mint decimals constraint was violated",
  ],
  [LangErrorCode.ConstraintSpace, "A space constraint was violated"],

  // Require.
  [LangErrorCode.RequireViolated, "A require expression was violated"],
  [LangErrorCode.RequireEqViolated, "A require_eq expression was violated"],
  [
    LangErrorCode.RequireKeysEqViolated,
    "A require_keys_eq expression was violated",
  ],
  [LangErrorCode.RequireNeqViolated, "A require_neq expression was violated"],
  [
    LangErrorCode.RequireKeysNeqViolated,
    "A require_keys_neq expression was violated",
  ],
  [LangErrorCode.RequireGtViolated, "A require_gt expression was violated"],
  [LangErrorCode.RequireGteViolated, "A require_gte expression was violated"],

  // Accounts.
  [
    LangErrorCode.AccountDiscriminatorAlreadySet,
    "The account discriminator was already set on this account",
  ],
  [
    LangErrorCode.AccountDiscriminatorNotFound,
    "No 8 byte discriminator was found on the account",
  ],
  [
    LangErrorCode.AccountDiscriminatorMismatch,
    "8 byte discriminator did not match what was expected",
  ],
  [LangErrorCode.AccountDidNotDeserialize, "Failed to deserialize the account"],
  [LangErrorCode.AccountDidNotSerialize, "Failed to serialize the account"],
  [
    LangErrorCode.AccountNotEnoughKeys,
    "Not enough account keys given to the instruction",
  ],
  [LangErrorCode.AccountNotMutable, "The given account is not mutable"],
  [
    LangErrorCode.AccountOwnedByWrongProgram,
    "The given account is owned by a different program than expected",
  ],
  [LangErrorCode.InvalidProgramId, "Program ID was not as expected"],
  [LangErrorCode.InvalidProgramExecutable, "Program account is not executable"],
  [LangErrorCode.AccountNotSigner, "The given account did not sign"],
  [
    LangErrorCode.AccountNotSystemOwned,
    "The given account is not owned by the system program",
  ],
  [
    LangErrorCode.AccountNotInitialized,
    "The program expected this account to be already initialized",
  ],
  [
    LangErrorCode.AccountNotProgramData,
    "The given account is not a program data account",
  ],
  [
    LangErrorCode.AccountNotAssociatedTokenAccount,
    "The given account is not the associated token account",
  ],
  [
    LangErrorCode.AccountSysvarMismatch,
    "The given public key does not match the required sysvar",
  ],

  // State.
  [
    LangErrorCode.StateInvalidAddress,
    "The given state account does not have the correct address",
  ],

  // Miscellaneous
  [
    LangErrorCode.DeclaredProgramIdMismatch,
    "The declared program id does not match the actual program id",
  ],

  // Deprecated
  [
    LangErrorCode.Deprecated,
    "The API being used is deprecated and should no longer be used",
  ],
]);
