import { Keypair, SystemProgram } from "@solana/web3.js";
import { PermissionAccount } from "@switchboard-xyz/switchboard-v2";
import BN from "bn.js";

import {
  program as escrowProgram,
  getAuthorityAddress as getMarketAuthorityAddress,
  getNoTokenAccountAddress,
  getYesTokenAccountAddress,
} from "@/hh-escrow";
import { createAggregator, createJob, createQueue, loadSwitchboardProgram } from "@/switchboard";
import { getResolverAddress, program } from "@/switchboard-resolver";
import { createInitMintInstructions, intoU64BN, sleep, spl, unixTimestamp } from "@/utils";

import type { OracleAccountData, OracleQueueAccountData, SwitchboardProgram } from "@/switchboard";
import type { PublicKey, Signer, TransactionInstruction } from "@solana/web3.js";
import type {
  AggregatorAccount,
  CrankAccount,
  OracleAccount,
  OracleQueueAccount,
} from "@switchboard-xyz/switchboard-v2";
import type { ChildProcess } from "child_process";
import type { Readable } from "stream";

describe("initialize switchboard resolver", () => {
  const authority = program.provider.wallet.publicKey;

  let switchboard: SwitchboardProgram;

  let queue: OracleQueueAccount,
    crank: CrankAccount,
    oracle: OracleAccount,
    aggregator: AggregatorAccount,
    funderAccount: Keypair,
    market: Keypair,
    mint: Keypair,
    resolver: PublicKey;

  //////////////////////////////////////////////////////////////////////////////

  const turnCrank = async (retry: number = 5) => {
    for (; retry > 0; retry--) {
      try {
        const readyPubkeys = await crank.peakNextReady(5);
        if (readyPubkeys.length > 0) {
          const crankData = await crank.loadData();
          const queueData: OracleQueueAccountData = await queue.loadData();

          return await crank.pop({
            payoutWallet: funderAccount.publicKey,
            queuePubkey: queue.publicKey,
            queueAuthority: queueData.authority,
            readyPubkeys,
            crank: crankData,
            queue,
            tokenMint: queueData.mint,
          });
        }
      } catch {
        // noop
      }
      await sleep(1000);
    }
    return undefined;
  };

  const initResolver = async (aggregatorResult: number | bigint) => {
    const job = await createJob(switchboard, {
      tasks: [
        {
          valueTask: { big: String(aggregatorResult) },
        },
      ],
    });

    ({ aggregator, funderAccount } = await createAggregator(
      switchboard,
      queue,
      {
        batchSize: 1,
        minRequiredOracleResults: 1,
        minRequiredJobResults: 1,
        minUpdateDelaySeconds: 10,
      },
      [[job, 1]],
    ));

    await crank.push({ aggregatorAccount: aggregator });

    const preIxs: Array<TransactionInstruction> = [];
    const signers: Array<Signer> = [];

    // Create market.
    {
      market = Keypair.generate();
      mint = Keypair.generate();
      resolver = getResolverAddress(market);

      const marketAuthority = getMarketAuthorityAddress(market);
      const [yesTokenAccount] = getYesTokenAccountAddress(market);
      const [noTokenAccount] = getNoTokenAccountAddress(market);

      preIxs.push(
        ...(await createInitMintInstructions({
          mint,
          mintAuthority: authority,
        })),
      );

      const closeTs = intoU64BN(unixTimestamp() + 3600n);
      const initialAmount = new BN(1_000_000);

      preIxs.push(
        await escrowProgram.methods
          .initializeMarket({
            closeTs,
            expiryTs: closeTs,
            resolutionDelay: 3600,
            yesAmount: initialAmount,
            noAmount: initialAmount,
            resolver,
            uri: "",
          })
          .accounts({
            market: market.publicKey,
            authority: marketAuthority,
            creator: authority,
            tokenMint: mint.publicKey,
            yesTokenAccount,
            noTokenAccount,
            systemProgram: SystemProgram.programId,
            tokenProgram: spl.programId,
          })
          .instruction(),
      );
      signers.push(mint, market);
    }

    await program.methods
      .initialize()
      .accounts({
        resolver,
        market: market.publicKey,
        feed: aggregator.publicKey,
        creator: authority,
        escrowProgram: escrowProgram.programId,
        systemProgram: SystemProgram.programId,
      })
      .preInstructions(preIxs)
      .signers(signers)
      .rpc();
  };

  //////////////////////////////////////////////////////////////////////////////

  let oracleProcess: (ChildProcess & { stdout: Readable; stderr: Readable }) | undefined;

  beforeAll(async () => {
    switchboard = await loadSwitchboardProgram;

    ({ queue, crank, oracle } = await createQueue(switchboard));

    // Hearbeat oracle.
    {
      const { tokenAccount }: OracleAccountData = await oracle.loadData();
      const queueData: OracleQueueAccountData = await queue.loadData();

      const gcOracle =
        queueData.size !== 0 ? (queueData.queue[queueData.gcIdx] as PublicKey) : oracle.publicKey;

      const [permission, permissionBump] = PermissionAccount.fromSeed(
        switchboard,
        queueData.authority,
        queue.publicKey,
        oracle.publicKey,
      );

      await switchboard.methods
        .oracleHeartbeat({ permissionBump })
        .accounts({
          oracle: oracle.publicKey,
          oracleAuthority: authority,
          tokenAccount,
          gcOracle,
          oracleQueue: queue.publicKey,
          permission: permission.publicKey,
          dataBuffer: queueData.dataBuffer,
        })
        .rpc();
    }

    // TODO: Start oracle.

    // oracleProcess = spawn("docker-compose", ["up"], {
    //   cwd: PROJECT_DIR,
    //   env: {
    //     ...process.env,
    //     RPC_URL: switchboard.provider.connection.rpcEndpoint,
    //     ORACLE_KEY: oracle.publicKey.toBase58(),
    //   },
    //   stdio: "pipe",
    //   shell: true,
    // }) as ChildProcess & { stdout: Readable; stderr: Readable };
    // oracleProcess.stdout.on("data", (chunk) => {
    //   console.log(chunk);
    // });
  });

  afterAll(() => {
    if (oracleProcess) {
      oracleProcess.kill();
      oracleProcess = undefined;
    }
  });

  //////////////////////////////////////////////////////////////////////////////

  it("successfully resolves to yes", async () => {
    await initResolver(1);

    if (!(await turnCrank())) {
      throw new Error("Failed to turn crank");
    }
  });
});
