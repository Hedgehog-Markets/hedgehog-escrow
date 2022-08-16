import type { InitializeMarketParams } from "./utils";

import { LangErrorCode } from "@project-serum/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";

import {
  intoU64BN,
  unixTimestamp,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createInitAccountInstructions,
  createInitMintInstructions,
  sendTx,
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

describe("claim", () => {
  const market = Keypair.generate();
  const mint = Keypair.generate();
  const user = Keypair.generate();
  const userTokenAccount = Keypair.generate();
  const resolver = Keypair.generate();

  const authority = getAuthorityAddress(market);
  const [yesTokenAccount] = getYesTokenAccountAddress(market);
  const [noTokenAccount] = getNoTokenAccountAddress(market);
  const userPosition = getUserPositionAddress(user, market);

  let feeWallet: PublicKey, feeAccount: PublicKey;

  //////////////////////////////////////////////////////////////////////////////

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

  //////////////////////////////////////////////////////////////////////////////

  it("fails if the global state address is incorrect", async () => {
    expect.assertions(1);

    // This is painful because anchor attempts to deserialize the account before
    // checking the seeds constraint.

    const [wrongGlobalState] = PublicKey.findProgramAddressSync(
      [Buffer.from("global2")],
      program.programId,
    );
    const [feeWallet] = PublicKey.findProgramAddressSync(
      [Buffer.from("global2"), Buffer.from("authority")],
      program.programId,
    );

    const feeAccount = getAssociatedTokenAddress(mint, feeWallet, true);

    await expect(
      claim()
        .accounts({ globalState: wrongGlobalState, feeAccount })
        .preInstructions([
          createAssociatedTokenAccountInstruction({
            account: feeAccount,
            mint,
            owner: feeWallet,
          }),
        ])
        .signers([user])
        .rpc(),
    ).rejects.toThrowProgramError(LangErrorCode.ConstraintSeeds);
  });

  it("fails if the fee account is has the wrong owner", async () => {
    expect.assertions(1);

    const wrongFeeAccount = Keypair.generate();
    const wrongFeeWallet = Keypair.generate();

    const preIxs = await createInitAccountInstructions({
      account: wrongFeeAccount,
      mint,
      user: wrongFeeWallet,
    });

    await expect(
      claim()
        .accounts({ feeAccount: wrongFeeAccount.publicKey })
        .preInstructions(preIxs)
        .signers([user, wrongFeeAccount])
        .rpc(),
    ).rejects.toThrowProgramError(LangErrorCode.ConstraintTokenOwner);
  });

  it("fails if the fee account is not the associated token account for the fee wallet and token mint", async () => {
    expect.assertions(1);

    const wrongFeeAccount = Keypair.generate();

    const preIxs = await createInitAccountInstructions({
      account: wrongFeeAccount,
      mint,
      user: feeWallet,
    });

    await expect(
      claim()
        .accounts({ feeAccount: wrongFeeAccount.publicKey })
        .preInstructions(preIxs)
        .signers([user, wrongFeeAccount])
        .rpc(),
    ).rejects.toThrowProgramError(LangErrorCode.ConstraintAssociated);
  });

  it("fails if the user provides the yes token account", async () => {
    expect.assertions(1);

    await expect(
      claim()
        .accounts({ userTokenAccount: yesTokenAccount })
        .signers([user])
        .rpc(),
    ).rejects.toThrowProgramError(ErrorCode.UserAccountCannotBeMarketAccount);
  });

  it("fails if the user provides the no token account", async () => {
    expect.assertions(1);

    await expect(
      claim()
        .accounts({ userTokenAccount: noTokenAccount })
        .signers([user])
        .rpc(),
    ).rejects.toThrowProgramError(ErrorCode.UserAccountCannotBeMarketAccount);
  });

  it("fails if the user provides a token account they do not own", async () => {
    expect.assertions(1);

    const wrongUserTokenAccount = Keypair.generate();
    const wrongUser = Keypair.generate();

    const preIxs = await createInitAccountInstructions({
      account: wrongUserTokenAccount,
      mint,
      user: wrongUser,
    });

    await expect(
      claim()
        .accounts({ userTokenAccount: wrongUserTokenAccount.publicKey })
        .preInstructions(preIxs)
        .signers([user, wrongUserTokenAccount])
        .rpc(),
    ).rejects.toThrowProgramError(ErrorCode.UserAccountIncorrectOwner);
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
      claim()
        .accounts({ userPosition: wrongUserPosition })
        .preInstructions(preIxs)
        .signers([user, wrongUser])
        .rpc(),
    ).rejects.toThrowProgramError(LangErrorCode.ConstraintSeeds);
  });

  it("fails if the yes token account provided is incorrect", async () => {
    expect.assertions(1);

    const wrongTokenAccount = Keypair.generate();

    const preIxs = await createInitAccountInstructions({
      account: wrongTokenAccount.publicKey,
      mint,
      user,
    });

    await expect(
      claim()
        .accounts({ yesTokenAccount: wrongTokenAccount.publicKey })
        .preInstructions(preIxs)
        .signers([user, wrongTokenAccount])
        .rpc(),
    ).rejects.toThrowProgramError(ErrorCode.IncorrectYesEscrow);
  });

  it("fails if the no token account provided is incorrect", async () => {
    expect.assertions(1);

    const wrongTokenAccount = Keypair.generate();

    const preIxs = await createInitAccountInstructions({
      account: wrongTokenAccount.publicKey,
      mint,
      user,
    });

    await expect(
      claim()
        .accounts({ noTokenAccount: wrongTokenAccount.publicKey })
        .preInstructions(preIxs)
        .signers([user, wrongTokenAccount])
        .rpc(),
    ).rejects.toThrowProgramError(ErrorCode.IncorrectNoEscrow);
  });

  it("fails if the market is not finalized", async () => {
    expect.assertions(1);

    await expect(claim().signers([user]).rpc()).rejects.toThrowProgramError(
      ErrorCode.NotFinalized,
    );
  });
});
