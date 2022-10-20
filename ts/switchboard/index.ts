import path from "path";

import { Program, getProvider } from "@project-serum/anchor";
import { NATIVE_MINT } from "@solana/spl-token";
import { Keypair, SystemProgram } from "@solana/web3.js";
import {
  CrankAccount,
  OracleAccount,
  OracleQueueAccount,
  PermissionAccount,
  ProgramStateAccount,
  SBV2_DEVNET_PID,
  SwitchboardDecimal,
  SwitchboardPermission,
} from "@switchboard-xyz/switchboard-v2";
import BN from "bn.js";
import fs from "graceful-fs";

import { PROJECT_DIR, __throw, addErrors, createInitAccountInstructions } from "@/utils";

import type { SwitchboardProgram, SwitchboardV2 } from "./types";
import type { Idl, IdlAccounts } from "@project-serum/anchor";
import type { PublicKey } from "@solana/web3.js";

export type { SwitchboardProgram, SwitchboardV2 } from "./types";

type SwitchboardAccounts = IdlAccounts<SwitchboardV2>;

export type OracleQueueAccountData = SwitchboardAccounts extends never
  ? Awaited<ReturnType<typeof OracleQueueAccount.prototype.loadData>>
  : Omit<SwitchboardAccounts["OracleQueueAccountData"], "ebuf"> & {
      queue: Array<PublicKey>;
    };
export type OracleAccountData = SwitchboardAccounts extends never
  ? Awaited<ReturnType<typeof OracleAccount.prototype.loadData>>
  : Omit<SwitchboardAccounts["OracleAccountData"], "ebuf">;

type IdlTypeDef = NonNullable<Idl["types"]>[number];

export const loadSwitchboardProgram = (async () => {
  const provider = getProvider();
  const idl =
    (await Program.fetchIdl<SwitchboardV2>(SBV2_DEVNET_PID, provider)) ??
    __throw(new Error("Failed to fetch Switchboard IDL"));

  // Attempt to remove bugged `Error` type.
  if (idl.types) {
    let bugged = false;

    const errorIdx = idl.types.findIndex((t) => t.name === ("Error" as never));
    if (errorIdx !== -1) {
      const { type } = idl.types[errorIdx] as IdlTypeDef;
      // We found the `Error` type, check if it is bugged.
      if (
        type.kind === "enum" &&
        type.variants.some(
          (v) => v.fields?.some((f) => typeof f !== "object" || !("name" in f)) ?? false,
        )
      ) {
        // Remove bugged type.
        idl.types.splice(errorIdx, 1);
        bugged = true;
      }
    }

    // If the bugged `Error` type can't be found, print a warning.
    if (!bugged) {
      console.warn("Bugged Switchboard IDL `Error` type doesn't exist");
    }
  }

  const json = JSON.stringify(idl, null, 2);
  const types = `export type SwitchboardV2 = ${json};\n\nexport const IDL: SwitchboardV2 = ${json};\n`;

  await fs.promises.writeFile(
    path.resolve(PROJECT_DIR, "target/types/switchboard_v2.ts"),
    types,
    "utf-8",
  );

  const switchboard = new Program(idl, SBV2_DEVNET_PID, provider) as unknown as SwitchboardProgram;

  // Ensure the program state account is created.
  await ProgramStateAccount.create(switchboard, { mint: NATIVE_MINT });

  // Add Switchboard errors to transaction error map.
  addErrors(switchboard.programId, switchboard.idl.errors);

  return switchboard;
})();

interface CreateQueueParams {
  queueSize?: number;
  crankSize?: number;
  reward?: BN;
  minStake?: BN;
}

export async function createQueue(
  switchboard: SwitchboardProgram,
  params: CreateQueueParams = {},
): Promise<{
  queue: OracleQueueAccount;
  crank: CrankAccount;
  oracle: OracleAccount;
}> {
  const provider = switchboard.provider;
  const connection = provider.connection;
  const authority = provider.wallet.publicKey;

  const [stateAccount, stateBump] = ProgramStateAccount.fromSeed(switchboard);
  const { tokenMint: mint } = await switchboard.account.sbState.fetch(stateAccount.publicKey);

  const queueKeypair = Keypair.generate();
  const queueBuffer = Keypair.generate();
  const queueSize = 8 + (params.crankSize ?? 500) * 32;

  const queue = new OracleQueueAccount({ program: switchboard, keypair: queueKeypair });

  const crankKeypair = Keypair.generate();
  const crankBuffer = Keypair.generate();
  const crankSize = 8 + (params.crankSize ?? 500) * 40;

  const crank = new CrankAccount({ program: switchboard, keypair: crankKeypair });

  {
    const preIxs = [
      SystemProgram.createAccount({
        fromPubkey: authority,
        newAccountPubkey: queueBuffer.publicKey,
        space: queueSize,
        lamports: await connection.getMinimumBalanceForRentExemption(queueSize),
        programId: switchboard.programId,
      }),
      await switchboard.methods
        .oracleQueueInit({
          name: [],
          metadata: [],
          reward: params.reward ?? new BN(0),
          minStake: params.minStake ?? new BN(0),
          feedProbationPeriod: 0,
          oracleTimeout: 180,
          slashingEnabled: false,
          varianceToleranceMultiplier: new SwitchboardDecimal(new BN(2), 0),
          consecutiveFeedFailureLimit: new BN(1000),
          consecutiveOracleFailureLimit: new BN(1000),
          queueSize,
          unpermissionedFeeds: false,
          unpermissionedVrf: false,
          enableBufferRelayers: false,
        })
        .accounts({
          oracleQueue: queueKeypair.publicKey,
          authority,
          buffer: queueBuffer.publicKey,
          mint,
          payer: authority,
          systemProgram: SystemProgram.programId,
        })
        .instruction(),
      SystemProgram.createAccount({
        fromPubkey: authority,
        newAccountPubkey: crankBuffer.publicKey,
        space: crankSize,
        lamports: await connection.getMinimumBalanceForRentExemption(crankSize),
        programId: switchboard.programId,
      }),
    ];

    await switchboard.methods
      .crankInit({
        name: Buffer.from("Crank"),
        metadata: Buffer.from(""),
        crankSize,
      })
      .accounts({
        crank: crankKeypair.publicKey,
        queue: queueKeypair.publicKey,
        buffer: crankBuffer.publicKey,
        payer: authority,
        systemProgram: SystemProgram.programId,
      })
      .preInstructions(preIxs)
      .signers([queueKeypair, queueBuffer, crankKeypair, crankBuffer])
      .rpc();
  }

  const tokenWallet = Keypair.generate();
  const [oracle, oracleBump] = OracleAccount.fromSeed(switchboard, queue, tokenWallet.publicKey);

  const [permission] = PermissionAccount.fromSeed(
    switchboard,
    authority,
    queue.publicKey,
    oracle.publicKey,
  );

  {
    const preIxs = [
      ...(await createInitAccountInstructions({
        account: tokenWallet,
        mint,
        user: stateAccount.publicKey,
      })),
      await switchboard.methods
        .oracleInit({
          name: Buffer.from("Oracle"),
          metadata: Buffer.from(""),
          stateBump,
          oracleBump,
        })
        .accounts({
          oracle: oracle.publicKey,
          oracleAuthority: authority,
          queue: queueKeypair.publicKey,
          wallet: tokenWallet.publicKey,
          programState: stateAccount.publicKey,
          payer: authority,
          systemProgram: SystemProgram.programId,
        })
        .instruction(),
      await switchboard.methods
        .permissionInit({})
        .accounts({
          permission: permission.publicKey,
          authority,
          granter: queue.publicKey,
          grantee: oracle.publicKey,
          payer: authority,
          systemProgram: SystemProgram.programId,
        })
        .instruction(),
    ];

    await switchboard.methods
      .permissionSet({
        permission: { [SwitchboardPermission.PERMIT_ORACLE_HEARTBEAT]: {} },
        enable: true,
      })
      .accounts({
        permission: permission.publicKey,
        authority,
      })
      .preInstructions(preIxs)
      .signers([tokenWallet])
      .rpc();
  }

  return { queue, crank, oracle };
}
