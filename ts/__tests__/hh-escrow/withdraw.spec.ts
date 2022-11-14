import { LangErrorCode } from "@project-serum/anchor";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Keypair, SystemProgram } from "@solana/web3.js";

import {
  ErrorCode,
  getAuthorityAddress,
  getNoTokenAccountAddress,
  getUserPositionAddress,
  getYesTokenAccountAddress,
  program,
} from "@/hh-escrow";
import {
  __throw,
  createInitAccountInstructions,
  createInitMintInstructions,
  getTokenBalance,
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

describe("withdraw", () => {
  const mint = Keypair.generate();
  const user = Keypair.generate();
  const userTokenAccount = Keypair.generate();
  const resolver = Keypair.generate();

  let market: Keypair,
    authority: PublicKey,
    yesTokenAccount: PublicKey,
    noTokenAccount: PublicKey,
    userPosition: PublicKey;

  let initMarketIx: TransactionInstruction, userPositionIx: TransactionInstruction;

  //////////////////////////////////////////////////////////////////////////////

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
    const topOff = TOP_OFF - intoU64(await getTokenBalance(userTokenAccount));
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

    const closeTs = unixTimestamp() + 3600n;
    const expiryTs = closeTs + 3600n;

    const params: InitializeMarketParams = {
      closeTs: intoU64BN(closeTs),
      expiryTs: intoU64BN(expiryTs),
      resolutionDelay: 3600,
      yesAmount: intoU64BN(YES_AMOUNT),
      noAmount: intoU64BN(NO_AMOUNT),
      resolver: resolver.publicKey,
      uri: "0".repeat(200),
    };

    initMarketIx = await program.methods
      .initializeMarket(params)
      .accounts({
        market: market.publicKey,
        authority,
        creator: program.provider.wallet.publicKey,
        tokenMint: mint.publicKey,
        yesTokenAccount,
        noTokenAccount,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();

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

  // it("fails if the market is not finalized", async () => {
  //   expect.assertions(1);

  //   await expect(
  //     withdraw()
  //       .preInstructions([initMarketIx, userPositionIx])
  //       .signers([market, user])
  //       .rpc(),
  //   ).rejects.toThrowProgramError(ErrorCode.NotFinalized);
  // });

  // it("fails if the user position is incorrect", async () => {
  //   expect.assertions(1);

  //   const wrongUser = Keypair.generate();
  //   const wrongUserPosition = getUserPositionAddress(wrongUser, market);

  //   const userPositionIx = await program.methods
  //     .initializeUserPosition()
  //     .accounts({
  //       user: wrongUser.publicKey,
  //       market: market.publicKey,
  //       userPosition: wrongUserPosition,
  //     })
  //     .instruction();

  //   await expect(
  //     withdraw()
  //       .accounts({ userPosition: wrongUserPosition })
  //       .preInstructions([initMarketIx, userPositionIx])
  //       .signers([market, wrongUser, user])
  //       .rpc(),
  //   ).rejects.toThrowProgramError(LangErrorCode.ConstraintSeeds);
  // });

  it("fails if the yes token account is incorrect", async () => {
    expect.assertions(1);

    const wrongTokenAccount = Keypair.generate();

    await expect(
      withdraw()
        .accounts({ yesTokenAccount: wrongTokenAccount.publicKey })
        .preInstructions([initMarketIx, userPositionIx])
        .signers([market, user])
        .rpc(),
    ).rejects.toThrowProgramError(ErrorCode.IncorrectYesEscrow);
  });

  it("fails if the no token account is incorrect", async () => {
    expect.assertions(1);

    const wrongTokenAccount = Keypair.generate();

    await expect(
      withdraw()
        .accounts({ noTokenAccount: wrongTokenAccount.publicKey })
        .preInstructions([initMarketIx, userPositionIx])
        .signers([market, user])
        .rpc(),
    ).rejects.toThrowProgramError(ErrorCode.IncorrectNoEscrow);
  });

  it("fails if the authority is incorrect", async () => {
    expect.assertions(1);

    const wrongAuthority = Keypair.generate();

    await expect(
      withdraw()
        .accounts({ authority: wrongAuthority.publicKey })
        .preInstructions([initMarketIx, userPositionIx])
        .signers([market, user])
        .rpc(),
    ).rejects.toThrowProgramError(LangErrorCode.ConstraintSeeds);
  });

  it("fails if the user token account provided is the yes token account", async () => {
    expect.assertions(1);

    await expect(
      withdraw()
        .accounts({ userTokenAccount: yesTokenAccount })
        .preInstructions([initMarketIx, userPositionIx])
        .signers([market, user])
        .rpc(),
    ).rejects.toThrowProgramError(ErrorCode.UserAccountCannotBeMarketAccount);
  });

  it("fails if the user token account provided is the no token account", async () => {
    expect.assertions(1);

    await expect(
      withdraw()
        .accounts({ userTokenAccount: noTokenAccount })
        .preInstructions([initMarketIx, userPositionIx])
        .signers([market, user])
        .rpc(),
    ).rejects.toThrowProgramError(ErrorCode.UserAccountCannotBeMarketAccount);
  });

  it("fails if the user token account is not owned by the user", async () => {
    expect.assertions(1);

    const otherUser = Keypair.generate();
    const otherTokenAccount = Keypair.generate();

    const newTokenAccountIxs = await createInitAccountInstructions({
      account: otherTokenAccount,
      mint,
      user: otherUser,
    });

    await expect(
      withdraw()
        .accounts({ userTokenAccount: otherTokenAccount.publicKey })
        .preInstructions([initMarketIx, userPositionIx, ...newTokenAccountIxs])
        .signers([market, user, otherTokenAccount])
        .rpc(),
    ).rejects.toThrowProgramError(ErrorCode.UserAccountIncorrectOwner);
  });

  it("successfully withdraws tokens for a user", async () => {
    expect.assertions(12);

    const closeTs = unixTimestamp() + 3600n;
    const expiryTs = closeTs + 3600n;

    const params: InitializeMarketParams = {
      closeTs: intoU64BN(closeTs),
      expiryTs: intoU64BN(expiryTs),
      resolutionDelay: 0, // Instantly finalize.
      yesAmount: intoU64BN(YES_AMOUNT),
      noAmount: intoU64BN(NO_AMOUNT),
      resolver: resolver.publicKey,
      uri: "0".repeat(200),
    };

    const initMarketIx = await program.methods
      .initializeMarket(params)
      .accounts({
        market: market.publicKey,
        authority,
        creator: program.provider.wallet.publicKey,
        tokenMint: mint.publicKey,
        yesTokenAccount,
        noTokenAccount,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();

    const yesDeposit = 1n;
    const noDeposit = 2n;

    await program.methods
      .deposit({
        yesAmount: intoU64BN(yesDeposit),
        noAmount: intoU64BN(noDeposit),
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
      .preInstructions([initMarketIx, userPositionIx])
      .signers([market, user])
      .rpc();

    await expect(yesTokenAccount).toHaveBalance(yesDeposit);
    await expect(noTokenAccount).toHaveBalance(noDeposit);
    await expect(userTokenAccount).toHaveBalance(TOP_OFF - yesDeposit - noDeposit);

    let { yesAmount: yesPosition, noAmount: noPosition } = await program.account.userPosition.fetch(
      userPosition,
    );

    expect(yesPosition).toEqualBN(yesDeposit);
    expect(noPosition).toEqualBN(noDeposit);

    await program.methods
      .updateState({ outcome: { invalid: {} } })
      .accounts({
        market: market.publicKey,
        resolver: resolver.publicKey,
      })
      .signers([resolver])
      .rpc();

    let { finalized } = await program.account.market.fetch(market.publicKey);

    expect(finalized).toBe(false);

    await withdraw().signers([user]).rpc();

    await expect(yesTokenAccount).toHaveBalance(0n);
    await expect(noTokenAccount).toHaveBalance(0n);
    await expect(userTokenAccount).toHaveBalance(TOP_OFF);

    ({ yesAmount: yesPosition, noAmount: noPosition } = await program.account.userPosition.fetch(
      userPosition,
    ));

    expect(yesPosition).toEqualBN(0n);
    expect(noPosition).toEqualBN(0n);

    ({ finalized } = await program.account.market.fetch(market.publicKey));

    expect(finalized).toBe(true);
  });
});
