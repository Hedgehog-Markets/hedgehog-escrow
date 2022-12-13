import { LangErrorCode } from "@project-serum/anchor";
import { Keypair } from "@solana/web3.js";

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

import type { DepositParams, InitializeMarketParams } from "@/hh-escrow";

const YES_AMOUNT = 1_000_000n;
const NO_AMOUNT = 2_000_000n;

const TOP_OFF = 5_000_000n;

// NOTE: Tests in this block have a dependency order.
describe("deposit", () => {
  const market = Keypair.generate();
  const mint = Keypair.generate();
  const user = Keypair.generate();
  const userTokenAccount = Keypair.generate();
  const resolver = Keypair.generate();

  const authority = getAuthorityAddress(market);
  const [yesTokenAccount] = getYesTokenAccountAddress(market);
  const [noTokenAccount] = getNoTokenAccountAddress(market);
  const userPosition = getUserPositionAddress(user, market);

  ///////////////////////////////////////////////////////////////////////////////

  const deposit = ({ yesAmount, noAmount, allowPartial }: Partial<DepositParams>) => {
    yesAmount ??= intoU64BN(YES_AMOUNT / 2n);
    noAmount ??= intoU64BN(NO_AMOUNT / 2n);
    allowPartial ??= false;

    return program.methods
      .deposit({
        yesAmount,
        noAmount,
        allowPartial,
      })
      .accounts({
        market: market.publicKey,
        user: user.publicKey,
        userPosition,
        userTokenAccount: userTokenAccount.publicKey,
        yesTokenAccount,
        noTokenAccount,
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

    await sendTx(
      [
        await program.methods
          .initializeMarket(params)
          .accounts({
            market: market.publicKey,
            tokenMint: mint.publicKey,
            authority,
            yesTokenAccount,
            noTokenAccount,
          })
          .instruction(),
        await program.methods
          .initializeUserPosition()
          .accounts({
            user: user.publicKey,
            market: market.publicKey,
            userPosition,
          })
          .instruction(),
      ],
      [market, user],
    );
  });

  beforeEach(async () => {
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
  });

  //////////////////////////////////////////////////////////////////////////////

  it("fails if the yes token account is incorrect", async () => {
    expect.assertions(1);

    const wrongTokenAccount = Keypair.generate();

    const preIxs = await createInitAccountInstructions({
      account: wrongTokenAccount,
      mint,
      user,
    });

    await expect(
      deposit({})
        .accounts({ yesTokenAccount: wrongTokenAccount.publicKey })
        .preInstructions(preIxs)
        .signers([wrongTokenAccount, user])
        .rpc(),
    ).rejects.toThrowProgramError(ErrorCode.IncorrectYesEscrow);
  });

  it("fails if the no token account is incorrect", async () => {
    expect.assertions(1);

    const wrongTokenAccount = Keypair.generate();

    const preIxs = await createInitAccountInstructions({
      account: wrongTokenAccount,
      mint,
      user,
    });

    await expect(
      deposit({})
        .accounts({ noTokenAccount: wrongTokenAccount.publicKey })
        .preInstructions(preIxs)
        .signers([wrongTokenAccount, user])
        .rpc(),
    ).rejects.toThrowProgramError(ErrorCode.IncorrectNoEscrow);
  });

  it("fails if the user position is incorrect", async () => {
    expect.assertions(1);

    const wrongUser = Keypair.generate();
    const wrongUserPosition = getUserPositionAddress(wrongUser, market);

    const preIxs = [
      await program.methods
        .initializeUserPosition()
        .accounts({
          user: wrongUser.publicKey,
          market: market.publicKey,
          userPosition: wrongUserPosition,
        })
        .instruction(),
    ];

    await expect(
      deposit({})
        .accounts({ userPosition: wrongUserPosition })
        .preInstructions(preIxs)
        .signers([user, wrongUser])
        .rpc(),
    ).rejects.toThrowProgramError(LangErrorCode.ConstraintSeeds);
  });

  it("fails if the yes deposit exceeds the market amount (allow_partial = false)", async () => {
    expect.assertions(1);

    await expect(
      deposit({ yesAmount: intoU64BN(YES_AMOUNT + 1n) })
        .signers([user])
        .rpc(),
    ).rejects.toThrowProgramError(ErrorCode.OverAllowedAmount);
  });

  it("fails if the no deposit exceeds the market amount (allow_partial = false)", async () => {
    expect.assertions(1);

    await expect(
      deposit({ noAmount: intoU64BN(NO_AMOUNT + 1n) })
        .signers([user])
        .rpc(),
    ).rejects.toThrowProgramError(ErrorCode.OverAllowedAmount);
  });

  it("successfully deposits", async () => {
    expect.assertions(4);

    await deposit({}).signers([user]).rpc();

    const { yesAmount, noAmount } = await program.account.userPosition.fetch(userPosition);
    const { yesFilled, noFilled } = await program.account.market.fetch(market.publicKey);

    expect(yesAmount).toEqualBN(YES_AMOUNT / 2n);
    expect(noAmount).toEqualBN(NO_AMOUNT / 2n);
    expect(yesFilled).toEqualBN(YES_AMOUNT / 2n);
    expect(noFilled).toEqualBN(NO_AMOUNT / 2n);
  });

  it("successfully deposits if the yes deposit exceeds the market amount (allow_partial = true)", async () => {
    expect.assertions(4);

    await deposit({ yesAmount: intoU64BN(YES_AMOUNT + 1n), allowPartial: true })
      .signers([user])
      .rpc();

    const { yesAmount, noAmount } = await program.account.userPosition.fetch(userPosition);
    const { yesFilled, noFilled } = await program.account.market.fetch(market.publicKey);

    expect(yesAmount).toEqualBN(YES_AMOUNT);
    expect(noAmount).toEqualBN(NO_AMOUNT);
    expect(yesFilled).toEqualBN(YES_AMOUNT);
    expect(noFilled).toEqualBN(NO_AMOUNT);
  });

  it("successfully deposits if the no deposit exceeds the market amount (allow_partial = true)", async () => {
    expect.assertions(4);

    await deposit({ noAmount: intoU64BN(NO_AMOUNT + 1n), allowPartial: true })
      .signers([user])
      .rpc();

    const { yesAmount, noAmount } = await program.account.userPosition.fetch(userPosition);
    const { yesFilled, noFilled } = await program.account.market.fetch(market.publicKey);

    expect(yesAmount).toEqualBN(YES_AMOUNT);
    expect(noAmount).toEqualBN(NO_AMOUNT);
    expect(yesFilled).toEqualBN(YES_AMOUNT);
    expect(noFilled).toEqualBN(NO_AMOUNT);
  });
});
