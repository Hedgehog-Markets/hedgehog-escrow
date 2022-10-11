import { Spl } from "@project-serum/anchor";

import { parseErrorCodes } from "./idl";

import type { Keypair, PublicKey } from "@solana/web3.js";
import type BN from "bn.js";

export const spl = Spl.token();
export const atoken = Spl.associatedToken();

export const SplErrorCode = parseErrorCodes(spl.idl.errors);
export const ATokenErrorCode = parseErrorCodes(atoken.idl.errors);

/**
 * Gets the balance of the given account.
 */
export async function getBalance(account: PublicKey | Keypair): Promise<BN> {
  if ("publicKey" in account) {
    account = account.publicKey;
  }
  const { amount } = await spl.account.token.fetch(account);
  return amount;
}
