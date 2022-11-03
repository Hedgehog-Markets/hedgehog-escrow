import { spawn, spawnSync } from "child_process";

import { Keypair, SystemProgram } from "@solana/web3.js";

import {
  program as escrowProgram,
  getAuthorityAddress as getMarketAuthorityAddress,
  getNoTokenAccountAddress,
  getUserPositionAddress,
  getYesTokenAccountAddress,
} from "@/hh-escrow";
import { createAggregator, createJob, createQueue, loadSwitchboardProgram } from "@/switchboard";
import { getResolverAddress, program } from "@/switchboard-resolver";
import {
  PROJECT_DIR,
  SKIP_FLAKY,
  __throw,
  chain,
  createInitAccountInstructions,
  createInitMintInstructions,
  intoU64BN,
  sleep,
  spl,
  unixTimestamp,
} from "@/utils";

import type { Outcome } from "@/hh-escrow";
import type { AggregatorAccountData, SwitchboardProgram } from "@/switchboard";
import type { PublicKey, Signer, TransactionInstruction } from "@solana/web3.js";
import type {
  AggregatorAccount,
  OracleAccount,
  OracleQueueAccount,
} from "@switchboard-xyz/switchboard-v2";
import type { ChildProcess } from "child_process";
import type { Readable } from "stream";

const DOCKER_COMPOSE = process.env.DOCKER_COMPOSE ?? "docker-compose";

const YES_AMOUNT = intoU64BN(100n);
const NO_AMOUNT = intoU64BN(200n);

const describeFlaky = SKIP_FLAKY ? describe.skip : describe;

describeFlaky("initialize switchboard resolver", () => {
  const authority = program.provider.wallet.publicKey;

  let switchboard: SwitchboardProgram;

  let queue: OracleQueueAccount,
    oracle: OracleAccount,
    aggregator: AggregatorAccount,
    funderAccount: Keypair,
    market: Keypair,
    mint: Keypair,
    resolver: PublicKey;

  //////////////////////////////////////////////////////////////////////////////

  const initResolver = async (aggregatorResult: number | bigint) => {
    const closeTs = intoU64BN(unixTimestamp() + 1n);

    // Create market and initialize user position.
    {
      const preIxs: Array<TransactionInstruction> = [];
      const signers: Array<Signer> = [];

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

      preIxs.push(
        await escrowProgram.methods
          .initializeMarket({
            closeTs,
            expiryTs: closeTs,
            resolutionDelay: 3600,
            yesAmount: YES_AMOUNT,
            noAmount: NO_AMOUNT,
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

      const userTokenAccount = Keypair.generate();
      const userPosition = getUserPositionAddress(authority, market);

      preIxs.push(
        await escrowProgram.methods
          .initializeUserPosition()
          .accounts({
            userPosition,
            market: market.publicKey,
            user: authority,
            payer: authority,
            systemProgram: SystemProgram.programId,
          })
          .instruction(),
        ...(await createInitAccountInstructions({
          account: userTokenAccount,
          mint,
          user: authority,
        })),
        await spl.methods
          .mintTo(YES_AMOUNT.add(NO_AMOUNT))
          .accounts({
            mint: mint.publicKey,
            authority: program.provider.wallet.publicKey,
            to: userTokenAccount.publicKey,
          })
          .instruction(),
      );
      signers.push(userTokenAccount);

      await escrowProgram.methods
        .deposit({
          yesAmount: YES_AMOUNT,
          noAmount: NO_AMOUNT,
          allowPartial: true,
        })
        .accounts({
          market: market.publicKey,
          user: authority,
          userPosition,
          userTokenAccount: userTokenAccount.publicKey,
          yesTokenAccount,
          noTokenAccount,
          tokenProgram: spl.programId,
        })
        .preInstructions(preIxs)
        .signers(signers)
        .rpc();
    }

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
        minUpdateDelaySeconds: 5,
        startAfter: closeTs,
      },
      [[job, 1]],
    ));

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
      .rpc();
  };

  //////////////////////////////////////////////////////////////////////////////

  let oracleLogs: (ChildProcess & { stdout: Readable; stderr: Readable }) | undefined;

  beforeAll(async () => {
    switchboard = await loadSwitchboardProgram;

    ({ queue, oracle } = await createQueue(switchboard));

    spawnSync(DOCKER_COMPOSE, ["up", "-d"], {
      cwd: PROJECT_DIR,
      env: {
        ...process.env,
        RPC_URL: switchboard.provider.connection.rpcEndpoint,
        ORACLE_KEY: oracle.publicKey.toBase58(),
      },
    });

    oracleLogs = spawn(DOCKER_COMPOSE, ["logs", "-f"], {
      cwd: PROJECT_DIR,
      stdio: "pipe",
    }) as ChildProcess & { stdout: Readable; stderr: Readable };

    // {
    //   const { stdout, stderr } = oracleLogs;

    //   stdout.setEncoding("utf-8");
    //   stderr.setEncoding("utf-8");

    //   stdout.on("data", (chunk: string) => console.log(chunk.trim()));
    //   stderr.on("data", (chunk: string) => console.error(chunk.trim()));
    // }

    let oracleReady: Promise<void>;
    {
      const { stdout } = oracleLogs;
      stdout.setEncoding("utf-8");

      oracleReady = new Promise<void>((resolve) => {
        stdout.on("data", (chunk: string) => {
          if (chunk.includes("Using default performance monitoring")) {
            resolve();
          }
        });
      });
    }

    await Promise.any([oracleReady, sleep(10_000)]);
  });

  afterAll(() => {
    if (oracleLogs !== undefined) {
      oracleLogs.kill();
      oracleLogs = undefined;
    }

    spawnSync(DOCKER_COMPOSE, ["kill", "--all"]);
  });

  //////////////////////////////////////////////////////////////////////////////

  it.each([
    { case: "yes", resolves: { yes: {} }, value: 1 },
    { case: "no", resolves: { no: {} }, value: 2 },
    { case: "invalid", resolves: { invalid: {} }, value: 3 },
  ])("successfully resolves to $case", async ({ resolves, value }) => {
    expect.assertions(1);

    await initResolver(value);

    // Wait until the market has reached the expiry.
    {
      const { expiryTs } = await escrowProgram.account.market.fetch(market.publicKey);
      await chain.sleepUntil(expiryTs.toNumber());
    }

    // Request the queue to update the aggregator.
    await aggregator.openRound({
      oracleQueueAccount: queue,
      payoutWallet: funderAccount.publicKey,
    });

    // Wait until the aggregator has a result.
    await new Promise<void>((resolve) => {
      let listener: number | undefined;

      listener = aggregator.onChange((data: AggregatorAccountData) => {
        if (data.latestConfirmedRound.numSuccess >= data.minOracleResults) {
          if (listener !== undefined) {
            void program.provider.connection.removeAccountChangeListener(listener);
            listener = undefined;
          }
          resolve();
        }
      });
    });

    // Resolve the market based on the aggregator feed.
    await program.methods
      .resolve()
      .accounts({
        resolver,
        market: market.publicKey,
        feed: aggregator.publicKey,
        escrowProgram: escrowProgram.programId,
      })
      .rpc();

    const { outcome } = await escrowProgram.account.market.fetch(market.publicKey);

    expect(outcome).toEqual<Outcome>(resolves);
  });
});
