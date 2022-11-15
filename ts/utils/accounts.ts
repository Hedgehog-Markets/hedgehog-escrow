import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TokenOwnerOffCurveError,
} from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";

import type { Keypair } from "@solana/web3.js";

export type Address = PublicKey | Keypair | string;

/**
 * Converts an address into a public key.
 */
export function translateAddress(address: Address): PublicKey;
export function translateAddress(address: undefined): undefined;
export function translateAddress(address: Address | undefined): PublicKey | undefined;
export function translateAddress(address: Address | undefined): PublicKey | undefined {
  if (address == null) {
    return undefined;
  } else if (typeof address === "string") {
    return new PublicKey(address);
  } else if ("publicKey" in address) {
    return address.publicKey;
  }
  return address;
}

export class ATokenAddress extends PublicKey {
  constructor(
    address: PublicKey,
    readonly owner: PublicKey,
    readonly mint: PublicKey,
    readonly programId: PublicKey,
  ) {
    super(address);
  }
}

/**
 * Gets the address of the associated token account for a given mint and owner.
 *
 * @param mint                     Token mint account
 * @param owner                    Owner of the new account
 * @param allowOwnerOffCurve       Allow the owner account to be a PDA (Program Derived Address)
 * @param programId                SPL Token program account
 * @param associatedTokenProgramId SPL Associated Token program account
 *
 * @return Address of the associated token account.
 */
export function getAssociatedTokenAddress(
  mint: Address,
  owner: Address,
  allowOwnerOffCurve: boolean = false,
  programId: Address = TOKEN_PROGRAM_ID,
  associatedTokenProgramId: Address = ASSOCIATED_TOKEN_PROGRAM_ID,
): ATokenAddress {
  owner = translateAddress(owner);

  if (!allowOwnerOffCurve && !PublicKey.isOnCurve(owner.toBuffer())) {
    throw new TokenOwnerOffCurveError();
  }

  mint = translateAddress(mint);
  programId = translateAddress(programId);
  associatedTokenProgramId = translateAddress(associatedTokenProgramId);

  const [address] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), programId.toBuffer(), mint.toBuffer()],
    associatedTokenProgramId,
  );

  return new ATokenAddress(address, owner, mint, programId);
}
