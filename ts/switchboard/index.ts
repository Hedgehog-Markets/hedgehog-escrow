import path from "path";

import { Program, getProvider } from "@project-serum/anchor";
import { NATIVE_MINT } from "@solana/spl-token";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { OracleJob } from "@switchboard-xyz/common";
import {
  AggregatorAccount,
  JobAccount,
  LeaseAccount,
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

import {
  PROJECT_DIR,
  __throw,
  addErrors,
  createAssociatedTokenAccountInstruction,
  createInitAccountInstructions,
  getAssociatedTokenAddress,
  packInstructions,
  sendAndConfirmTransaction,
  signTransactions,
  spl,
  toBuffer,
} from "@/utils";

import type { SwitchboardProgram, SwitchboardV2 } from "./types";
import type { ExpandRecursively } from "@/utils";
import type { IdlAccounts, IdlTypes } from "@project-serum/anchor";
import type { Signer, Transaction, TransactionInstruction } from "@solana/web3.js";
import type { IOracleJob } from "@switchboard-xyz/common";

export type { SwitchboardProgram, SwitchboardV2 } from "./types";

type SwitchboardAccounts = IdlAccounts<SwitchboardV2>;
type SwitchboardTypes = IdlTypes<SwitchboardV2>;

type AccountData<
  Account extends { loadData: () => Promise<unknown> },
  Name extends keyof SwitchboardAccounts,
  Extra = Record<never, never>,
> = SwitchboardAccounts extends never
  ? Awaited<ReturnType<Account["loadData"]>>
  : ExpandRecursively<Omit<SwitchboardAccounts[Name], "ebuf"> & Extra>;

export type SbState = AccountData<ProgramStateAccount, "SbState">;
export type OracleQueueAccountData = AccountData<
  OracleQueueAccount,
  "OracleQueueAccountData",
  { queue: Array<PublicKey> }
>;
export type OracleAccountData = AccountData<OracleAccount, "OracleAccountData">;
export type AggregatorAccountData = AccountData<
  AggregatorAccount,
  "AggregatorAccountData",
  {
    currentRound: AggregatorRound;
    latestConfirmedRound: AggregatorRound;
  }
>;
export type LeaseAccountData = AccountData<LeaseAccount, "LeaseAccountData">;
export type AggregatorRound = ExpandRecursively<SwitchboardTypes["AggregatorRound"]>;

export const loadSwitchboardProgram = (async () => {
  const provider = getProvider();
  const idl =
    (await Program.fetchIdl<SwitchboardV2>(SBV2_DEVNET_PID, provider)) ??
    __throw(new Error("Failed to fetch Switchboard IDL"));

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

/**
 * Devnet permissionless queue address.
 */
export const PERMISSIONLESS_QUEUE = new PublicKey("F8ce7MsckeZAbAGmxjJNetxYXQa9mKr9nnrC3qKubyYy");

interface CreateQueueParams {
  queueSize?: number;
  reward?: BN;
  minStake?: BN;

  queueKeypair?: Keypair;
  oracleWallet?: Keypair;
}

export async function createQueue(
  switchboard: SwitchboardProgram,
  params: CreateQueueParams = {},
): Promise<{
  queue: OracleQueueAccount & { keypair: Keypair };
  oracle: OracleAccount;
}> {
  const provider = switchboard.provider;
  const connection = provider.connection;
  const authority = provider.wallet.publicKey;

  const ixs: Array<TransactionInstruction> = [];
  const signers: Array<Signer> = [];

  const [state, stateBump] = ProgramStateAccount.fromSeed(switchboard);
  const { tokenMint: mint } = await switchboard.account.sbState.fetch(state.publicKey);

  const queueKeypair = params.queueKeypair ?? Keypair.generate();
  const queueBuffer = Keypair.generate();
  const queueSize = 8 + (params.queueSize ?? 500) * 32;

  const queue = new OracleQueueAccount({
    program: switchboard,
    keypair: queueKeypair,
  }) as OracleQueueAccount & { keypair: Keypair };

  ixs.push(
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
        consecutiveFeedFailureLimit: new BN(1_000),
        consecutiveOracleFailureLimit: new BN(1_000),
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
  );
  signers.push(queueKeypair, queueBuffer);

  const oracleWallet = params.oracleWallet ?? Keypair.generate();

  ixs.push(
    ...(await createInitAccountInstructions({
      account: oracleWallet,
      mint,
      user: state.publicKey,
    })),
  );
  signers.push(oracleWallet);

  const [oracle, oracleBump] = OracleAccount.fromSeed(switchboard, queue, oracleWallet.publicKey);

  const [permission] = PermissionAccount.fromSeed(
    switchboard,
    authority,
    queue.publicKey,
    oracle.publicKey,
  );

  ixs.push(
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
        wallet: oracleWallet.publicKey,
        programState: state.publicKey,
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
    await switchboard.methods
      .permissionSet({
        permission: { [SwitchboardPermission.PERMIT_ORACLE_HEARTBEAT]: {} },
        enable: true,
      })
      .accounts({
        permission: permission.publicKey,
        authority,
      })
      .instruction(),
  );

  const { blockhash } = await connection.getLatestBlockhash();

  let txs: Array<Transaction>;
  txs = packInstructions(ixs, authority, blockhash);
  txs = signTransactions(txs, signers);
  txs = await provider.wallet.signAllTransactions(txs);

  for (const tx of txs) {
    await sendAndConfirmTransaction(connection, tx, {
      skipPreflight: false,
      maxRetries: 10,
    });
  }

  return { queue, oracle };
}

interface CreateAggregatorParams {
  batchSize: number;
  minRequiredOracleResults: number;
  minRequiredJobResults: number;
  minUpdateDelaySeconds?: number;
  startAfter?: BN;

  keypair?: Keypair;
  authority?: Keypair;
}

export async function createAggregator(
  switchboard: SwitchboardProgram,
  queue: OracleQueueAccount,
  params: CreateAggregatorParams,
  jobs: Array<[job: JobAccount, weight: number]> = [],
): Promise<{
  aggregator: AggregatorAccount & { keypair: Keypair };
  lease: LeaseAccount;
}> {
  const { connection, wallet } = switchboard.provider;

  const payer = wallet.publicKey;
  const authority = params.authority?.publicKey ?? payer;

  const [state, stateBump] = ProgramStateAccount.fromSeed(switchboard);

  const queueData: OracleQueueAccountData = await queue.loadData();
  const queueAuthority = queueData.authority;

  let mint = queueData.mint;
  if (mint.equals(PublicKey.default)) {
    ({ tokenMint: mint } = await state.loadData());
  }

  const aggregatorKeypair = params.keypair ?? Keypair.generate();
  const aggregator = new AggregatorAccount({
    program: switchboard,
    keypair: aggregatorKeypair,
  }) as AggregatorAccount & { keypair: Keypair };
  const aggregatorSize = switchboard.account.aggregatorAccountData.size;

  const [permission] = PermissionAccount.fromSeed(
    switchboard,
    queueAuthority,
    queue.publicKey,
    aggregatorKeypair.publicKey,
  );

  const [lease, leaseBump] = LeaseAccount.fromSeed(switchboard, queue, aggregator);
  const leaseEscrow = getAssociatedTokenAddress(mint, lease.publicKey, true);

  const ixs: Array<TransactionInstruction> = [];
  const signers: Array<Signer> = [aggregatorKeypair];

  if (params.authority) {
    signers.push(params.authority);
  }

  ixs.push(
    SystemProgram.createAccount({
      fromPubkey: payer,
      newAccountPubkey: aggregatorKeypair.publicKey,
      space: aggregatorSize,
      lamports: await connection.getMinimumBalanceForRentExemption(aggregatorSize),
      programId: switchboard.programId,
    }),
    await switchboard.methods
      .aggregatorInit({
        name: [],
        metadata: [],
        batchSize: params.batchSize,
        minOracleResults: params.minRequiredOracleResults,
        minJobResults: params.minRequiredJobResults,
        minUpdateDelaySeconds: params.minUpdateDelaySeconds ?? 15,
        startAfter: params.startAfter ?? new BN(0),
        varianceThreshold: new SwitchboardDecimal(new BN(0), 0),
        forceReportPeriod: new BN(0),
        expiration: new BN(0),
        disableCrank: true,
        stateBump,
      })
      .accounts({
        aggregator: aggregatorKeypair.publicKey,
        authority,
        queue: queue.publicKey,
        programState: state.publicKey,
      })
      .instruction(),
    await switchboard.methods
      .permissionInit({})
      .accounts({
        permission: permission.publicKey,
        authority: queueAuthority,
        granter: queue.publicKey,
        grantee: aggregator.publicKey,
        payer,
        systemProgram: SystemProgram.programId,
      })
      .instruction(),
  );

  if (authority.equals(queueAuthority)) {
    ixs.push(
      await switchboard.methods
        .permissionSet({
          permission: { [SwitchboardPermission.PERMIT_ORACLE_QUEUE_USAGE]: {} },
          enable: true,
        })
        .accounts({
          permission: permission.publicKey,
          authority,
        })
        .instruction(),
    );
  }

  const funderAccount = Keypair.generate();
  ixs.push(
    ...(await createInitAccountInstructions({
      account: funderAccount,
      mint,
      user: authority,
      payer,
    })),
  );
  signers.push(funderAccount);

  ixs.push(
    createAssociatedTokenAccountInstruction({
      account: leaseEscrow,
      owner: lease.publicKey,
      mint,
      payer,
    }),
    await switchboard.methods
      .leaseInit({
        loadAmount: new BN(0),
        stateBump,
        leaseBump,
        withdrawAuthority: authority,
        walletBumps: Buffer.from([]),
      })
      .accounts({
        lease: lease.publicKey,
        queue: queue.publicKey,
        aggregator: aggregator.publicKey,
        funder: funderAccount.publicKey,
        payer,
        systemProgram: SystemProgram.programId,
        tokenProgram: spl.programId,
        owner: authority,
        escrow: leaseEscrow,
        programState: state.publicKey,
        mint,
      })
      .instruction(),
    ...(await Promise.all(
      jobs.map(async ([job, weight]) =>
        switchboard.methods
          .aggregatorAddJob({ weight })
          .accounts({
            aggregator: aggregator.publicKey,
            authority,
            job: job.publicKey,
          })
          .instruction(),
      ),
    )),
    await switchboard.methods
      .aggregatorLock({})
      .accounts({
        aggregator: aggregator.publicKey,
        authority,
      })
      .instruction(),
  );

  const { blockhash } = await connection.getLatestBlockhash();

  let txs: Array<Transaction>;
  txs = packInstructions(ixs, payer, blockhash);
  txs = signTransactions(txs, signers);
  txs = await wallet.signAllTransactions(txs);

  for (const tx of txs) {
    await sendAndConfirmTransaction(connection, tx, {
      skipPreflight: false,
      maxRetries: 10,
    });
  }

  return { aggregator, lease };
}

export async function createJob(
  switchboard: SwitchboardProgram,
  job: IOracleJob & { keypair?: Keypair; authority?: Keypair },
): Promise<JobAccount & { keypair: Keypair }> {
  const payer = switchboard.provider.wallet.publicKey;
  const authority = job.authority?.publicKey ?? payer;

  const [state, stateBump] = ProgramStateAccount.fromSeed(switchboard);

  const jobKeypair = job.keypair ?? Keypair.generate();
  const jobData = toBuffer(OracleJob.encodeDelimited({ tasks: job.tasks ?? null }).finish());
  const jobAccount = new JobAccount({
    program: switchboard,
    keypair: jobKeypair,
  }) as JobAccount & { keypair: Keypair };

  const signers: Array<Signer> = [jobKeypair];

  if (job.authority) {
    signers.push(job.authority);
  }

  let data = jobData;
  let size: number | null = null;
  const chunks: Array<Buffer> = [];

  const CHUNK_SIZE = 800;
  if (jobData.byteLength > CHUNK_SIZE) {
    data = Buffer.alloc(0);
    size = jobData.byteLength;

    for (let i = 0; i < size; ) {
      const end = i + CHUNK_SIZE;
      // If `end > size` the chunk will be truncated, which is fine.
      chunks.push(jobData.subarray(i, end));
      i = end;
    }
  }

  await switchboard.methods
    .jobInit({
      name: [],
      expiration: new BN(0),
      stateBump,
      data,
      size,
    })
    .accounts({
      job: jobKeypair.publicKey,
      authority,
      programState: state.publicKey,
      payer,
      systemProgram: SystemProgram.programId,
    })
    .signers(signers)
    .rpc();

  // If we had to chunk up the data, then send out the chunked transactions.
  for (const [n, chunk] of chunks.entries()) {
    await switchboard.methods
      .jobSetData({
        data: chunk,
        chunkIdx: n,
      })
      .accounts({
        job: jobKeypair.publicKey,
        authority,
      })
      .signers(signers)
      .rpc();
  }

  return jobAccount;
}
