import type { HhEscrow } from "../../target/types/hh_escrow";
import type { IdlTypes, Program } from "@project-serum/anchor";

import * as anchor from "@project-serum/anchor";

import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";

import {
  BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
  intoU64BN,
  parseErrorCodes,
} from "../utils";

type EscrowTypes = IdlTypes<HhEscrow>;

export type InitializeMarketParams = EscrowTypes["InitializeMarketParams"];
export type UriResource = EscrowTypes["UriResource"];
export type DepositParams = EscrowTypes["DepositParams"];
export type UpdateStateParams = EscrowTypes["UpdateStateParams"];
export type Outcome = EscrowTypes["Outcome"];

export const program: Program<HhEscrow> = anchor.workspace.HhEscrow;

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

  const protocolFeeBps = 100; // 1%.

  let _feeWallet = Keypair.generate();
  let _authority = Keypair.generate();

  return {
    get address(): PublicKey {
      return address;
    },

    get authority(): Keypair {
      return _authority;
    },
    get feeWallet(): Keypair {
      return _feeWallet;
    },
    get protocolFeeBps(): number {
      return protocolFeeBps;
    },

    async initialize(): Promise<void> {
      const state = await program.account.globalState.fetchNullable(address);
      if (state) {
        if (!state.authority.equals(_authority.publicKey)) {
          throw new Error(
            `Global state authority is not the expected: ${_authority.publicKey.toBase58()}`,
          );
        }
        if (!state.feeWallet.equals(_feeWallet.publicKey)) {
          throw new Error(
            `Global state fee wallet is not the expected: ${_feeWallet.publicKey.toBase58()}`,
          );
        }
        return;
      }

      await program.methods
        .initializeGlobalState({
          authority: _authority.publicKey,
          feeWallet: _feeWallet.publicKey,
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
        .rpc();
    },

    async updateFeeWallet(feeWallet: Keypair): Promise<void> {
      const state = await program.account.globalState.fetch(address);
      if (!state.feeWallet.equals(feeWallet.publicKey)) {
        throw new Error(
          `Failed to update global state fee wallet to ${feeWallet.publicKey.toBase58()}, expected ${state.feeWallet.toBase58()}`,
        );
      }
      _feeWallet = feeWallet;
    },
    async updateAuthority(authority: Keypair): Promise<void> {
      const state = await program.account.globalState.fetch(address);
      if (!state.authority.equals(authority.publicKey)) {
        throw new Error(
          `Failed to update global state authority to ${authority.publicKey.toBase58()}, expected ${state.authority.toBase58()}`,
        );
      }
      _authority = authority;
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
