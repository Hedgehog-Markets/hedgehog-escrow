import { LangErrorCode } from "@project-serum/anchor";
import { Keypair, SystemProgram } from "@solana/web3.js";
import { AggregatorAccount } from "@switchboard-xyz/switchboard-v2";
import BN from "bn.js";

import {
  program as escrowProgram,
  getAuthorityAddress as getMarketAuthorityAddress,
  getNoTokenAccountAddress,
  getYesTokenAccountAddress,
} from "@/hh-escrow";
import { createQueue, loadSwitchboardProgram } from "@/switchboard";
import { ErrorCode, getResolverAddress, program } from "@/switchboard-resolver";
import { createInitMintInstructions, intoU64BN, spl, unixTimestamp } from "@/utils";

import type { SwitchboardProgram } from "@/switchboard";
import type { PublicKey } from "@solana/web3.js";
import type { OracleQueueAccount } from "@switchboard-xyz/switchboard-v2";

describe("initialize switchboard resolver", () => {
  const authority = program.provider.wallet.publicKey;

  let switchboard: SwitchboardProgram,
    queue: OracleQueueAccount,
    aggreggator: AggregatorAccount,
    market: Keypair,
    mint: Keypair,
    resolver: PublicKey;

  //////////////////////////////////////////////////////////////////////////////

  const initialize = () =>
    program.methods.initialize().accounts({
      resolver,
      market: market.publicKey,
      feed: aggreggator.publicKey,
      creator: authority,
      escrowProgram: escrowProgram.programId,
      systemProgram: SystemProgram.programId,
    });

  //////////////////////////////////////////////////////////////////////////////

  beforeAll(async () => {
    switchboard = await loadSwitchboardProgram;

    // Create queue, crank, and oracle.
    ({ queue } = await createQueue(switchboard));

    // Create aggreggator.
    aggreggator = await AggregatorAccount.create(switchboard, {
      authority,
      batchSize: 1,
      minRequiredOracleResults: 1,
      minRequiredJobResults: 1,
      minUpdateDelaySeconds: 10,
      queueAccount: queue,
    });

    // Create market.
    {
      market = Keypair.generate();
      mint = Keypair.generate();
      resolver = getResolverAddress(market);

      const marketAuthority = getMarketAuthorityAddress(market);
      const [yesTokenAccount] = getYesTokenAccountAddress(market);
      const [noTokenAccount] = getNoTokenAccountAddress(market);

      const preIxs = await createInitMintInstructions({
        mint,
        mintAuthority: authority,
      });

      const closeTs = intoU64BN(unixTimestamp() + 3600n);
      const initialAmount = new BN(1_000_000);

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
        .preInstructions(preIxs)
        .signers([mint, market])
        .rpc();
    }
  });

  //////////////////////////////////////////////////////////////////////////////

  it("fails if resolver is incorrect", async () => {
    expect.assertions(1);

    const market = Keypair.generate();

    const marketAuthority = getMarketAuthorityAddress(market);
    const [yesTokenAccount] = getYesTokenAccountAddress(market);
    const [noTokenAccount] = getNoTokenAccountAddress(market);

    const resolver = getResolverAddress(market);

    const wrongResolver = Keypair.generate();

    const closeTs = intoU64BN(unixTimestamp() + 3600n);
    const initialAmount = new BN(1_000_000);

    await escrowProgram.methods
      .initializeMarket({
        closeTs,
        expiryTs: closeTs,
        resolutionDelay: 3600,
        yesAmount: initialAmount,
        noAmount: initialAmount,
        resolver: wrongResolver.publicKey,
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
      .signers([market])
      .rpc();

    await expect(
      initialize().accounts({ resolver, market: market.publicKey }).rpc(),
    ).rejects.toThrowProgramError(ErrorCode.IncorrectResolver);
  });

  it("fails if resolver is not PDA", async () => {
    expect.assertions(1);

    const wrongResolver = Keypair.generate();

    await expect(
      initialize().accounts({ resolver: wrongResolver.publicKey }).rpc(),
    ).rejects.toThrowProgramError(LangErrorCode.ConstraintSeeds);
  });

  it("fails if creator is incorrect", async () => {
    expect.assertions(1);

    const wrongCreator = Keypair.generate();

    await expect(
      initialize().accounts({ creator: wrongCreator.publicKey }).signers([wrongCreator]).rpc(),
    ).rejects.toThrowProgramError(ErrorCode.IncorrectCreator);
  });

  it("successfully inititializes resolver", async () => {
    expect.assertions(2);

    await initialize().rpc();

    const data = await program.account.resolver.fetch(resolver);

    expect(data.market).toEqualPubkey(market.publicKey);
    expect(data.feed).toEqualPubkey(aggreggator.publicKey);
  });
});
