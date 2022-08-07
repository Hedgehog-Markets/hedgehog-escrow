import process from "process";

import * as anchor from "@project-serum/anchor";

import { PublicKey } from "@solana/web3.js";

export const BPF_LOADER_UPGRADEABLE_PROGRAM_ID = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111",
);

export const ESCROW_PROGRAM_ID = anchor.workspace.HhEscrow.programId;
export { IDL as ESCROW_PROGRAM_IDL } from "../../target/types/hh_escrow";

export const SKIP_FLAKY = process.env.SKIP_FLAKY === "1";
