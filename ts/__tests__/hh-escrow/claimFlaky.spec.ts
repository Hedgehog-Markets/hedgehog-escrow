import { Keypair } from "@solana/web3.js";

import {
  ErrorCode,
  getAuthorityAddress,
  getNoTokenAccountAddress,
  getUserPositionAddress,
  getYesTokenAccountAddress,
  globalState,
  program,
} from "@/hh-escrow";
import {
  SKIP_FLAKY,
  __throw,
  chain,
  createAssociatedTokenAccountInstruction,
  createInitAccountInstructions,
  createInitMintInstructions,
  getAssociatedTokenAddress,
  getBalance,
  intoU64,
  intoU64BN,
  sendTx,
  spl,
  unixTimestamp,
} from "@/utils";

import type { InitializeMarketParams } from "@/hh-escrow";
import type { PublicKey, TransactionInstruction } from "@solana/web3.js";

const YES_AMOUNT = 1_000_000n;
const NO_AMOUNT = 2_000_000n;

const TOP_OFF = 5_000_000n;

const describeFlaky = SKIP_FLAKY ? describe.skip : describe;

// NOTE: These tests are flaky. To test interactions we generally aim to set the
// close timestamp to be the same as the timestamp when the market is
// initialized so we can immediately process an update on it.
//
// This is done by setting the timestamp to the upcoming block. If the
// instruction does not appear in that given block, the tests will fail.
describeFlaky("claim (clock-dependent)", () => {
  jest.retryTimes(2);

  const mint = Keypair.generate();
  const user = Keypair.generate();
  const userTokenAccount = Keypair.generate();
  const resolver = Keypair.generate();

  let feeWallet: PublicKey, feeAccount: PublicKey;

  let market: Keypair,
    authority: PublicKey,
    yesTokenAccount: PublicKey,
    noTokenAccount: PublicKey,
    userPosition: PublicKey;

  let userPositionIx: TransactionInstruction;

  //////////////////////////////////////////////////////////////////////////////

  const initMarketParams = ({
    closeTs,
    expiryTs,
    resolutionDelay,
    yesAmount,
    noAmount,
    resolver: resolver_,
    uri,
  }: Partial<InitializeMarketParams>): InitializeMarketParams => {
    closeTs ??= intoU64BN(unixTimestamp() + 3600n);
    expiryTs ??= closeTs.addn(3600);
    resolutionDelay ??= 3600;
    yesAmount ??= intoU64BN(YES_AMOUNT);
    noAmount ??= intoU64BN(NO_AMOUNT);
    resolver_ ??= resolver.publicKey;
    uri ??= "0".repeat(200);

    return {
      closeTs,
      expiryTs,
      resolutionDelay,
      yesAmount,
      noAmount,
      resolver: resolver_,
      uri,
    };
  };

  const claim = () =>
    program.methods.claim().accounts({
      globalState: globalState.address,
      feeAccount,
      userTokenAccount: userTokenAccount.publicKey,
      yesTokenAccount,
      noTokenAccount,
      userPosition,
      market: market.publicKey,
      authority,
      user: user.publicKey,
    });

  //////////////////////////////////////////////////////////////////////////////

  beforeAll(async () => {
    // Ensure global state is initialized and matches expected state.
    await globalState.initialize();

    feeWallet = await globalState.getFeeWallet();
    feeAccount = getAssociatedTokenAddress(mint, feeWallet, true);

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
        createAssociatedTokenAccountInstruction({
          account: feeAccount,
          owner: feeWallet,
          mint,
        }),
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
  });

  //////////////////////////////////////////////////////////////////////////////

  it("fails if the market has finalized to invalid", async () => {
    expect.assertions(1);

    const time = await chain.blockTimestamp();
    const closeTs = time + 2;

    const params = initMarketParams({ closeTs: intoU64BN(closeTs) });

    await program.methods
      .initializeMarket(params)
      .accounts({
        market: market.publicKey,
        tokenMint: mint.publicKey,
        authority,
        yesTokenAccount,
        noTokenAccount,
      })
      .postInstructions([userPositionIx])
      .signers([market, user])
      .rpc();

    await chain.sleepUntil(closeTs);

    await expect(claim().signers([user]).rpc()).rejects.toThrowProgramError(ErrorCode.CannotClaim);
  });

  it("successfully claims", async () => {
    expect.assertions(6);

    const otherUserTokenAccount = Keypair.generate();
    const otherUser = Keypair.generate();

    const otherUserPosition = getUserPositionAddress(otherUser, market);

    const diff = 117n;
    const noAmount = NO_AMOUNT - diff;

    // Prep a deposit from another user.
    {
      const preIxs = await createInitAccountInstructions({
        account: otherUserTokenAccount,
        mint,
        user: otherUser,
      });

      await spl.methods
        .mintTo(intoU64BN(noAmount))
        .accounts({
          mint: mint.publicKey,
          authority: program.provider.wallet.publicKey,
          to: otherUserTokenAccount.publicKey,
        })
        .signers([otherUserTokenAccount])
        .preInstructions(preIxs)
        .rpc();
    }

    const depositUserIx = await program.methods
      .deposit({
        yesAmount: intoU64BN(YES_AMOUNT),
        noAmount: intoU64BN(diff),
        allowPartial: true,
      })
      .accounts({
        user: user.publicKey,
        market: market.publicKey,
        yesTokenAccount,
        noTokenAccount,
        userTokenAccount: userTokenAccount.publicKey,
        userPosition,
      })
      .instruction();

    const otherUserPositionIx = await program.methods
      .initializeUserPosition()
      .accounts({
        user: otherUser.publicKey,
        market: market.publicKey,
        userPosition: otherUserPosition,
      })
      .instruction();

    let expiryTs: number;
    {
      const time = await chain.blockTimestamp();

      const closeTs = intoU64BN((expiryTs = time + 2));
      const params = initMarketParams({
        closeTs,
        expiryTs: closeTs,
        resolutionDelay: 0,
      });

      const initMarketIx = await program.methods
        .initializeMarket(params)
        .accounts({
          market: market.publicKey,
          tokenMint: mint.publicKey,
          authority,
          yesTokenAccount,
          noTokenAccount,
        })
        .instruction();

      await program.methods
        .deposit({
          yesAmount: intoU64BN(0),
          noAmount: intoU64BN(noAmount),
          allowPartial: true,
        })
        .accounts({
          user: otherUser.publicKey,
          market: market.publicKey,
          yesTokenAccount,
          noTokenAccount,
          userTokenAccount: otherUserTokenAccount.publicKey,
          userPosition: otherUserPosition,
        })
        .signers([market, otherUser, user])
        .preInstructions([initMarketIx, userPositionIx, otherUserPositionIx, depositUserIx])
        .rpc();
    }

    await chain.sleepUntil(expiryTs);

    const updateOutcomeIx = await program.methods
      .updateState({ outcome: { no: {} } })
      .accounts({
        market: market.publicKey,
        resolver: resolver.publicKey,
      })
      .instruction();

    await claim().preInstructions([updateOutcomeIx]).signers([user, resolver]).rpc();

    const { yesAmount: yesPosition, noAmount: noPosition } =
      await program.account.userPosition.fetch(userPosition);

    expect(yesPosition).toEqualBN(0);
    expect(noPosition).toEqualBN(0);

    await expect(yesTokenAccount).toHaveBalance(999_942n);
    await expect(noTokenAccount).toHaveBalance(noAmount);
    await expect(feeAccount).toHaveBalance(1n);
    await expect(userTokenAccount).toHaveBalance(4_000_057n);
  });
});
