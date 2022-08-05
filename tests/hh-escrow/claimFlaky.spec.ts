import type { InitializeMarketParams } from "./utils";

import { Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";

import {
  spl,
  intoU64,
  intoU64BN,
  unixTimestamp,
  getBalance,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createInitAccountInstructions,
  createInitMintInstructions,
  sendTx,
  sleep,
  __throw,
} from "../utils";

import {
  ErrorCode,
  program,
  globalState,
  getAuthorityAddress,
  getYesTokenAccountAddress,
  getNoTokenAccountAddress,
  getUserPositionAddress,
} from "./utils";

const YES_AMOUNT = 1_000_000n;
const NO_AMOUNT = 2_000_000n;

const TOP_OFF = 5_000_000n;

describe.skip("claim (clock-dependent)", () => {
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

  let userPositionIx: TransactionInstruction,
    updateStateIx: TransactionInstruction;

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

  const tryGetCurrentTimestamp = async () => {
    const epochInfo = await program.provider.connection.getEpochInfo();
    const time = await program.provider.connection.getBlockTime(
      epochInfo.absoluteSlot + 1,
    );

    return time ?? __throw(new Error("Failed to get block time"));
  };

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

    updateStateIx = await program.methods
      .updateState({ outcome: { No: {} } })
      .accounts({
        market: market.publicKey,
        resolver: resolver.publicKey,
      })
      .instruction();
  });

  //////////////////////////////////////////////////////////////////////////////

  it("fails if the market has finalized to invalid", async () => {
    jest.retryTimes(2);

    expect.assertions(1);

    const time = await tryGetCurrentTimestamp();

    const closeTs = intoU64BN(time + 2);
    const expiryTs = intoU64BN(time + 3602);

    const params = initMarketParams({ closeTs, expiryTs });

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

    {
      const finalizeTs = closeTs.toNumber();

      let finalized = false;

      for (let i = 0; i < 80; i++) {
        await sleep(100);

        const time = await tryGetCurrentTimestamp();
        if (finalizeTs <= time) {
          finalized = true;
          break;
        }
      }

      if (!finalized) {
        throw new Error("Timed out waiting for clock progression");
      }
    }

    await expect(claim().signers([user]).rpc()).rejects.toThrowProgramError(
      ErrorCode.CannotClaim,
    );
  });

  it("successfully claims", async () => {
    jest.retryTimes(2);

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
      const time = await tryGetCurrentTimestamp();

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
        .preInstructions([
          initMarketIx,
          userPositionIx,
          otherUserPositionIx,
          depositUserIx,
        ])
        .rpc();
    }

    {
      let pastExpiry = false;

      for (let i = 0; i < 80; i++) {
        await sleep(100);

        const time = await tryGetCurrentTimestamp();
        if (expiryTs <= time) {
          pastExpiry = true;
          break;
        }
      }

      if (!pastExpiry) {
        throw new Error("Timed out waiting for clock progression");
      }
    }

    await claim()
      .preInstructions([updateStateIx])
      .signers([user, resolver])
      .rpc();

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
