import type { InitializeMarketParams } from "./utils";

import {
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

import {
  SKIP_FLAKY,
  spl,
  intoU64,
  intoU64BN,
  unixTimestamp,
  getBalance,
  createInitAccountInstructions,
  createInitMintInstructions,
  sendTx,
  chain,
  __throw,
} from "../utils";

import {
  ErrorCode,
  program,
  getAuthorityAddress,
  getYesTokenAccountAddress,
  getNoTokenAccountAddress,
  getUserPositionAddress,
} from "./utils";

const YES_AMOUNT = intoU64BN(100n);
const NO_AMOUNT = intoU64BN(200n);

const TOP_OFF = 500n;

const describeFlaky = SKIP_FLAKY ? describe.skip : describe;

// NOTE: These tests are flaky. To test interactions we generally aim to set the
// close timestamp to be the same as the timestamp when the market is
// initialized so we can immediately process an update on it.
//
// This is done by setting the timestamp to the upcoming block. If the
// instruction does not appear in that given block, the tests will fail.
describeFlaky("update state (clock-dependent)", () => {
  jest.retryTimes(2);

  const mint = Keypair.generate();
  const user = Keypair.generate();
  const userTokenAccount = Keypair.generate();
  const resolver = Keypair.generate();

  let market: Keypair,
    authority: PublicKey,
    yesTokenAccount: PublicKey,
    noTokenAccount: PublicKey,
    userPosition: PublicKey;

  let userPositionIx: TransactionInstruction, depositIx: TransactionInstruction;

  //////////////////////////////////////////////////////////////////////////////

  const initMarket = ({
    closeTs,
    expiryTs,
    resolutionDelay,
    yesAmount,
    noAmount,
    resolver: resolver_,
    uri,
  }: Partial<InitializeMarketParams>) => {
    closeTs ??= intoU64BN(unixTimestamp() + 3600n);
    expiryTs ??= closeTs.addn(3600);
    resolutionDelay ??= 3600;
    yesAmount ??= YES_AMOUNT;
    noAmount ??= NO_AMOUNT;
    resolver_ ??= resolver.publicKey;
    uri ??= "0".repeat(200);

    return program.methods
      .initializeMarket({
        closeTs,
        expiryTs,
        resolutionDelay,
        yesAmount,
        noAmount,
        resolver: resolver_,
        uri,
      })
      .accounts({
        market: market.publicKey,
        authority,
        creator: program.provider.wallet.publicKey,
        tokenMint: mint.publicKey,
        yesTokenAccount,
        noTokenAccount,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      });
  };

  //////////////////////////////////////////////////////////////////////////////

  beforeAll(async () => {
    await sendTx(
      [
        ...(await createInitMintInstructions({
          mint,
          mintAuthority: program.provider.wallet.publicKey,
        })),
        ...(await createInitAccountInstructions({
          account: userTokenAccount,
          mint,
          user,
        })),
      ],
      [mint, userTokenAccount],
    );
  });

  beforeEach(async () => {
    market = Keypair.generate();

    authority = getAuthorityAddress(market);
    [yesTokenAccount] = getYesTokenAccountAddress(market);
    [noTokenAccount] = getNoTokenAccountAddress(market);
    userPosition = getUserPositionAddress(user, market);

    // Top off the user's token account before each test.
    const topOff = TOP_OFF - intoU64(await getBalance(userTokenAccount));
    if (topOff > 0n) {
      await spl.methods
        .mintTo(intoU64BN(topOff))
        .accounts({
          mint: mint.publicKey,
          authority: program.provider.wallet.publicKey,
          to: userTokenAccount.publicKey,
        })
        .rpc();
    }

    userPositionIx = await program.methods
      .initializeUserPosition()
      .accounts({
        userPosition,
        market: market.publicKey,
        user: user.publicKey,
        payer: program.provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .instruction();

    depositIx = await program.methods
      .deposit({
        yesAmount: YES_AMOUNT,
        noAmount: NO_AMOUNT,
        allowPartial: true,
      })
      .accounts({
        market: market.publicKey,
        user: user.publicKey,
        userPosition,
        userTokenAccount: userTokenAccount.publicKey,
        yesTokenAccount,
        noTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();
  });

  //////////////////////////////////////////////////////////////////////////////

  it.each([
    { case: "yes", outcome: { Yes: {} } },
    { case: "no", outcome: { No: {} } },
  ] as const)(
    "fails to update to $case if market has not expired",
    async ({ outcome }) => {
      expect.assertions(1);

      const time = await chain.blockTimestamp();

      const preIxs = [
        await initMarket({ closeTs: intoU64BN(time + 3600) }).instruction(),
      ];

      await expect(
        program.methods
          .updateOutcome({ outcome })
          .accounts({
            market: market.publicKey,
            resolver: resolver.publicKey,
          })
          .preInstructions(preIxs)
          .signers([market, resolver])
          .rpc(),
      ).rejects.toThrowProgramError(ErrorCode.InvalidTransition);
    },
  );

  it("fails if the resolver is incorrect when the market is not finalized", async () => {
    expect.assertions(1);

    const wrongResolver = Keypair.generate();

    const time = await chain.blockTimestamp();

    const preIxs = [
      await initMarket({ closeTs: intoU64BN(time + 3600) }).instruction(),
      userPositionIx,
      depositIx,
    ];

    await expect(
      program.methods
        .updateOutcome({ outcome: { Invalid: {} } })
        .accounts({
          market: market.publicKey,
          resolver: wrongResolver.publicKey,
        })
        .preInstructions(preIxs)
        .signers([market, user, wrongResolver])
        .rpc(),
    ).rejects.toThrowProgramError(ErrorCode.IncorrectResolver);
  });

  it("successfully updates to invalid before market has expired", async () => {
    expect.assertions(2);

    const time = await chain.blockTimestamp();

    const preIxs = [
      await initMarket({ closeTs: intoU64BN(time + 3600) }).instruction(),
    ];

    await program.methods
      .updateOutcome({ outcome: { Invalid: {} } })
      .accounts({
        market: market.publicKey,
        resolver: resolver.publicKey,
      })
      .preInstructions(preIxs)
      .signers([market, resolver])
      .rpc();

    const info = await program.account.market.fetch(market.publicKey);

    expect(info.outcomeTs).toEqualBN(time);
    expect(info.outcome).toStrictEqual({ Invalid: {} });
  });

  it("successfully updates to open before market has expired", async () => {
    expect.assertions(2);

    const time = await chain.blockTimestamp();

    const preIxs = [
      await initMarket({ closeTs: intoU64BN(time + 3600) }).instruction(),
      await program.methods
        .updateOutcome({ outcome: { Invalid: {} } })
        .accounts({
          market: market.publicKey,
          resolver: resolver.publicKey,
        })
        .instruction(),
    ];

    await program.methods
      .updateOutcome({ outcome: { Open: {} } })
      .accounts({
        market: market.publicKey,
        resolver: resolver.publicKey,
      })
      .preInstructions(preIxs)
      .signers([market, resolver])
      .rpc();

    const info = await program.account.market.fetch(market.publicKey);

    expect(info.outcomeTs).toEqualBN(0n);
    expect(info.outcome).toStrictEqual({ Open: {} });
  });

  it("fails to update to open after market has expired", async () => {
    expect.assertions(1);

    const time = await chain.blockTimestamp();
    const expiryTs = time + 2;

    const preIxs = [
      await initMarket({
        closeTs: intoU64BN(expiryTs),
        expiryTs: intoU64BN(expiryTs),
      }).instruction(),
      userPositionIx,
      depositIx,
    ];

    await program.methods
      .updateOutcome({ outcome: { Invalid: {} } })
      .accounts({
        market: market.publicKey,
        resolver: resolver.publicKey,
      })
      .preInstructions(preIxs)
      .signers([market, user, resolver])
      .rpc();

    await chain.sleepUntil(expiryTs);

    await expect(
      program.methods
        .updateOutcome({ outcome: { Open: {} } })
        .accounts({
          market: market.publicKey,
          resolver: resolver.publicKey,
        })
        .signers([resolver])
        .rpc(),
    ).rejects.toThrowProgramError(ErrorCode.InvalidTransition);
  });

  it.each([
    { case: "yes", outcome: { Yes: {} } },
    { case: "no", outcome: { No: {} } },
    { case: "invalid", outcome: { Invalid: {} } },
  ] as const)(
    "successfully updates to $case after market has expired",
    async ({ outcome }) => {
      expect.assertions(2);

      const time = await chain.blockTimestamp();
      const expiryTs = time + 2;

      await sendTx(
        [
          await initMarket({
            closeTs: intoU64BN(expiryTs),
            expiryTs: intoU64BN(expiryTs),
          }).instruction(),
          userPositionIx,
          depositIx,
        ],
        [market, user],
      );

      await chain.sleepUntil(expiryTs);

      await program.methods
        .updateOutcome({ outcome })
        .accounts({
          market: market.publicKey,
          resolver: resolver.publicKey,
        })
        .signers([resolver])
        .rpc();

      const info = await program.account.market.fetch(market.publicKey);

      expect(info.outcomeTs).toEqualBN(expiryTs);
      expect(info.outcome).toStrictEqual(outcome);
    },
  );

  it("auto-finalizes without the resolver", async () => {
    expect.assertions(4);

    const time = await chain.blockTimestamp();
    const expiryTs = time + 2;

    await initMarket({
      closeTs: intoU64BN(expiryTs),
      expiryTs: intoU64BN(expiryTs),
    })
      .signers([market])
      .rpc();

    let info = await program.account.market.fetch(market.publicKey);

    expect(info.outcome).toStrictEqual({ Open: {} });
    expect(info.finalized).toBe(false);

    await chain.sleepUntil(expiryTs);

    await program.methods
      .updateOutcome({ outcome: { Open: {} } })
      .accounts({
        market: market.publicKey,
        resolver: program.provider.wallet.publicKey,
      })
      .rpc();

    info = await program.account.market.fetch(market.publicKey);

    expect(info.outcome).toStrictEqual({ Invalid: {} });
    expect(info.finalized).toBe(true);
  });
});
