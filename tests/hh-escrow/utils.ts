import type { HhEscrow } from "../../target/types/hh_escrow";
import type { IdlTypes } from "@project-serum/anchor";
import type { Address } from "../utils";

import { Program } from "@project-serum/anchor";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";

import {
  ProgramError,
  SystemErrorCode,
  BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
  ESCROW_PROGRAM_ID,
  ESCROW_PROGRAM_IDL,
  parseErrorCodes,
  translateAddress,
  getAssociatedTokenAddress,
  sendTx,
} from "../utils";

type EscrowTypes = IdlTypes<HhEscrow>;

export type InitializeMarketParams = EscrowTypes["InitializeMarketParams"];
export type UriResource = EscrowTypes["UriResource"];
export type DepositParams = EscrowTypes["DepositParams"];
export type UpdateStateParams = EscrowTypes["UpdateStateParams"];
export type Outcome = EscrowTypes["Outcome"];

export const program = new Program(ESCROW_PROGRAM_IDL, ESCROW_PROGRAM_ID);
export const ErrorCode = parseErrorCodes(program.idl.errors);

export const [programData] = PublicKey.findProgramAddressSync(
  [program.programId.toBytes()],
  BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
);

export const globalState = (() => {
  const [address] = PublicKey.findProgramAddressSync(
    [Buffer.from("global")],
    program.programId,
  );

  const authority = Keypair.fromSecretKey(
    Uint8Array.from([
      190, 156, 93, 38, 182, 223, 17, 79, 244, 122, 157, 254, 116, 127, 149, 59,
      98, 121, 64, 98, 226, 153, 88, 126, 202, 242, 63, 187, 189, 104, 123, 206,
      146, 157, 191, 135, 21, 111, 205, 114, 182, 102, 151, 154, 114, 124, 226,
      152, 232, 67, 164, 38, 69, 247, 197, 191, 206, 71, 9, 16, 215, 110, 40,
      101,
    ]),
  );

  return {
    get address(): PublicKey {
      return address;
    },

    get authority(): Keypair {
      return authority;
    },

    async fetch() {
      return await program.account.globalState.fetch(address);
    },

    async getFeeWallet(): Promise<PublicKey> {
      return (await this.fetch()).feeWallet;
    },
    async getProtocolFeeBps(): Promise<number> {
      return (await this.fetch()).protocolFeeBps.bps;
    },

    async initialize(): Promise<void> {
      const state = await program.account.globalState.fetchNullable(address);
      if (state) {
        if (!state.authority.equals(authority.publicKey)) {
          throw new Error(
            `Global state authority is not the expected: ${authority.publicKey.toBase58()}`,
          );
        }
        return;
      }

      const [feeWallet] = PublicKey.findProgramAddressSync(
        [Buffer.from("fee_wallet")],
        program.programId,
      );
      const protocolFeeBps = 100; // 1%.

      try {
        await sendTx(
          await program.methods
            .initializeGlobalState({
              authority: authority.publicKey,
              feeWallet,
              protocolFeeBps,
            })
            .accounts({
              globalState: address,
              payer: program.provider.wallet.publicKey,
              upgradeAuthority: program.provider.wallet.publicKey,
              escrowProgram: program.programId,
              programData,
              systemProgram: SystemProgram.programId,
            })
            .transaction(),
        );
      } catch (err) {
        if (
          err instanceof ProgramError &&
          err.program.equals(SystemProgram.programId) &&
          err.code === SystemErrorCode.AccountAlreadyInUse
        ) {
          return;
        }
        throw err;
      }
    },

    async getFeeAccountFor(mint: Address): Promise<PublicKey> {
      return getAssociatedTokenAddress(mint, await this.getFeeWallet(), true);
    },
  };
})();

/**
 * Interpret the on-chain representation of a `UriResource` as a string.
 */
export function interpretMarketResource({ len, uri }: UriResource): string {
  const buf = Buffer.from(uri).subarray(0, len);
  return buf.toString("utf8");
}

/**
 * Gets the address of the authority account for a given market.
 */
export function getAuthorityAddress(market: Address): PublicKey {
  const [authority] = PublicKey.findProgramAddressSync(
    [Buffer.from("authority"), translateAddress(market).toBuffer()],
    program.programId,
  );
  return authority;
}

/**
 * Gets the address of the yes token account for a given market.
 */
export function getYesTokenAccountAddress(
  market: Address,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("yes"), translateAddress(market).toBuffer()],
    program.programId,
  );
}

/**
 * Gets the address of the no token account for a given market.
 */
export function getNoTokenAccountAddress(market: Address): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("no"), translateAddress(market).toBuffer()],
    program.programId,
  );
}

/**
 * Gets the address of the user position account for a given user and market.
 */
export function getUserPositionAddress(
  user: Address,
  market: Address,
): PublicKey {
  const [userPosition] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("user"),
      translateAddress(user).toBuffer(),
      translateAddress(market).toBuffer(),
    ],
    program.programId,
  );
  return userPosition;
}
