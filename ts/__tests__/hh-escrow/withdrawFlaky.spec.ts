import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Keypair, PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";

import {
  ErrorCode,
  getAuthorityAddress,
  getNoTokenAccountAddress,
  getUserPositionAddress,
  getYesTokenAccountAddress,
  program,
} from "@/hh-escrow";
import {
  SKIP_FLAKY,
  __throw,
  chain,
  createInitAccountInstructions,
  createInitMintInstructions,
  getBalance,
  intoU64,
  intoU64BN,
  sendTx,
  spl,
  unixTimestamp,
} from "@/utils";

import type { InitializeMarketParams } from "@/hh-escrow";

const YES_AMOUNT = intoU64BN(1_000_000n);
const NO_AMOUNT = intoU64BN(2_000_000n);

const TOP_OFF = 5_000_000n;

const describeFlaky = SKIP_FLAKY ? describe.skip : describe;

// NOTE: These tests are flaky. To test interactions we generally aim to set the
// close timestamp to be the same as the timestamp when the market is
// initialized so we can immediately process an update on it.
//
// This is done by setting the timestamp to the upcoming block. If the
// instruction does not appear in that given block, the tests will fail.
describeFlaky("withdraw (clock-dependent)", () => {
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

  const withdraw = () =>
    program.methods.withdraw().accounts({
      user: user.publicKey,
      yesTokenAccount,
      noTokenAccount,
      userTokenAccount: userTokenAccount.publicKey,
      authority,
      market: market.publicKey,
      userPosition,
      tokenProgram: TOKEN_PROGRAM_ID,
    });

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
        user: user.publicKey,
        market: market.publicKey,
        userPosition,
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

  it("fails if the outcome is not invalid", async () => {
    expect.assertions(1);

    const time = await chain.blockTimestamp();
    const expiryTs = time + 2;

    await sendTx(
      [
        await initMarket({
          closeTs: intoU64BN(expiryTs),
          expiryTs: intoU64BN(expiryTs),
          resolutionDelay: 0,
        }).instruction(),
        userPositionIx,
        depositIx,
      ],
      [market, user],
    );

    await chain.sleepUntil(expiryTs);

    const preIxs = [
      await program.methods
        .updateState({ outcome: { yes: {} } })
        .accounts({ market: market.publicKey, resolver: resolver.publicKey })
        .instruction(),
    ];

    await expect(
      withdraw().preInstructions(preIxs).signers([resolver, user]).rpc(),
    ).rejects.toThrowProgramError(ErrorCode.MarketNotInvalid);
  });
});
