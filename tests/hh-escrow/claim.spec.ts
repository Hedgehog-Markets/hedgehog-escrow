// Because these tests require the presence of program data, they should be run
// using a separate test validator (`anchor test` injects the program directly
// instead of deploying, and hence does not initialize program data).
//
// Because of this, these tests require a different set up. To run these tests:
//
// 1. Clear any existing ledger (usually located in `test-ledger`)
// 2. Start a local validator with `$ solana-test-validator`.
// 3. Set the solana cluster to localnet with `solana config set --url
//    [validator url]`.
// 4. Run `anchor run pre_test_deploy && anchor test --skip-deploy --skip-build
//    --skip-local-validator [filter]`.
// 5. Shut down the validator once tests are complete.

import type { HhEscrow } from "../../target/types/hh_escrow";
import type { InitializeMarketParams } from "./utils";

import * as anchor from "@project-serum/anchor";

import { Program, LangErrorCode, AnchorError } from "@project-serum/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";

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

import { ErrorCode, program, globalState } from "./utils";

const YES_AMOUNT = 1_000_000;
const NO_AMOUNT = 2_000_000;

// These test shouldn't be flaky since they hit failures that can be
// consistently set without worrying about the clock.
describe("claim failure tests", () => {
  const market = Keypair.generate();
  const mint = Keypair.generate();
  const user = Keypair.generate();
  const userTokenAccount = Keypair.generate();
  const resolver = Keypair.generate();

  const [authority] = PublicKey.findProgramAddressSync(
    [Buffer.from("authority"), market.publicKey.toBuffer()],
    program.programId,
  );
  const [yesTokenAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("yes"), market.publicKey.toBuffer()],
    program.programId,
  );
  const [noTokenAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("no"), market.publicKey.toBuffer()],
    program.programId,
  );
  const [userPosition] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("user"),
      user.publicKey.toBuffer(),
      market.publicKey.toBuffer(),
    ],
    program.programId,
  );

  let feeAccount: PublicKey;

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

    feeAccount = globalState.getFeeAccountFor(mint);

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
          owner: globalState.feeWallet,
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

  it("fails to claim if the provided global state is incorrect", async () => {
    expect.assertions(1);

    // This is painful because anchor attempts to deserialize the account before checking the constraints.

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
        .accounts({
          globalState: wrongGlobalState,
          feeAccount,
        })
        .preInstructions([
          createAssociatedTokenAccountInstruction({
            account: feeAccount,
            mint,
            owner: feeWallet,
          }),
        ])
        .signers([user])
        .rpc(),
    ).rejects.toThrowAnchorError(LangErrorCode.ConstraintSeeds);
  });

  // it("fails to claim if the provided fee account is not owned by the fee wallet", async () => {
  //   expect.assertions(1);

  //   const otherAccount = Keypair.generate();
  //   const otherAccountIxs = await createInitAccountInstructions({
  //     account: otherAccount.publicKey,
  //     mint: mint.publicKey,
  //     user: Keypair.generate().publicKey,
  //     connection: provider.connection,
  //     payer: provider.wallet.publicKey,
  //   });

  //   await expect(
  //     program.methods
  //       .claim()
  //       .accounts({
  //         globalState,
  //         feeAccount: otherAccount.publicKey,
  //         userTokenAccount: userTokenAccount.publicKey,
  //         yesTokenAccount,
  //         noTokenAccount,
  //         userPosition,
  //         market: market.publicKey,
  //         authority,
  //         user: user.publicKey,
  //       })
  //       .preInstructions([...otherAccountIxs])
  //       .signers([user, otherAccount])
  //       .rpc(),
  //   ).rejects.toThrowAnchorError(ErrorCode.AccountNotOwnedByFeeWallet);
  // });

  // it("fails to claim if the provided fee account is not the associated token account", async () => {
  //   expect.assertions(1);

  //   const otherAccount = Keypair.generate();
  //   const otherAccountIxs = await createInitAccountInstructions({
  //     account: otherAccount.publicKey,
  //     mint: mint.publicKey,
  //     user: feeWallet.publicKey,
  //     connection: provider.connection,
  //     payer: provider.wallet.publicKey,
  //   });

  //   await expect(
  //     program.methods
  //       .claim()
  //       .accounts({
  //         globalState,
  //         feeAccount: otherAccount.publicKey,
  //         userTokenAccount: userTokenAccount.publicKey,
  //         yesTokenAccount,
  //         noTokenAccount,
  //         userPosition,
  //         market: market.publicKey,
  //         authority,
  //         user: user.publicKey,
  //       })
  //       .preInstructions([...otherAccountIxs])
  //       .signers([user, otherAccount])
  //       .rpc(),
  //   ).rejects.toThrowProgramError(ErrorCode.AssociatedTokenAccountRequired);
  // });

  // it("fails to claim if the user provides the yes/no token account", async () => {
  //   expect.assertions(2);

  //   await expect(
  //     program.methods
  //       .claim()
  //       .accounts({
  //         globalState,
  //         feeAccount,
  //         userTokenAccount: yesTokenAccount,
  //         yesTokenAccount,
  //         noTokenAccount,
  //         userPosition,
  //         market: market.publicKey,
  //         authority,
  //         user: user.publicKey,
  //       })
  //       .signers([user])
  //       .rpc(),
  //   ).rejects.toThrowAnchorError(ErrorCode.UserAccountCannotBeMarketAccount);

  //   await expect(
  //     program.methods
  //       .claim()
  //       .accounts({
  //         globalState,
  //         feeAccount,
  //         userTokenAccount: noTokenAccount,
  //         yesTokenAccount,
  //         noTokenAccount,
  //         userPosition,
  //         market: market.publicKey,
  //         authority,
  //         user: user.publicKey,
  //       })
  //       .signers([user])
  //       .rpc(),
  //   ).rejects.toThrowAnchorError(ErrorCode.UserAccountCannotBeMarketAccount);
  // });

  // it("fails to claim if the user provides a token account they do not own", async () => {
  //   expect.assertions(1);

  //   const otherAccount = Keypair.generate();
  //   const otherAccountIxs = await createInitAccountInstructions({
  //     account: otherAccount.publicKey,
  //     mint: mint.publicKey,
  //     user: feeWallet.publicKey,
  //     connection: provider.connection,
  //     payer: provider.wallet.publicKey,
  //   });

  //   await expect(
  //     program.methods
  //       .claim()
  //       .accounts({
  //         globalState,
  //         feeAccount,
  //         userTokenAccount: otherAccount.publicKey,
  //         yesTokenAccount,
  //         noTokenAccount,
  //         userPosition,
  //         market: market.publicKey,
  //         authority,
  //         user: user.publicKey,
  //       })
  //       .preInstructions([...otherAccountIxs])
  //       .signers([user, otherAccount])
  //       .rpc(),
  //   ).rejects.toThrowAnchorError(ErrorCode.UserAccountIncorrectOwner);
  // });

  // it("fails to claim if the user position is incorrect", async () => {
  //   expect.assertions(1);

  //   const otherUser = Keypair.generate();
  //   const [otherUserPosition] = PublicKey.findProgramAddressSync(
  //     [
  //       Buffer.from("user"),
  //       otherUser.publicKey.toBuffer(),
  //       market.publicKey.toBuffer(),
  //     ],
  //     program.programId,
  //   );
  //   const otherUserPositionIx = await program.methods
  //     .initializeUserPosition()
  //     .accounts({
  //       user: otherUser.publicKey,
  //       market: market.publicKey,
  //       userPosition: otherUserPosition,
  //     })
  //     .instruction();

  //   await expect(
  //     program.methods
  //       .claim()
  //       .accounts({
  //         globalState,
  //         feeAccount,
  //         userTokenAccount: userTokenAccount.publicKey,
  //         yesTokenAccount,
  //         noTokenAccount,
  //         userPosition: otherUserPosition,
  //         market: market.publicKey,
  //         authority,
  //         user: user.publicKey,
  //       })
  //       .preInstructions([otherUserPositionIx])
  //       .signers([user, otherUser])
  //       .rpc(),
  //   ).rejects.toThrowAnchorError(LangErrorCode.ConstraintSeeds);
  // });

  // it("fails to claim if the yes token account provided is incorrect", async () => {
  //   expect.assertions(1);

  //   const otherAccount = Keypair.generate();
  //   const otherAccountIxs = await createInitAccountInstructions({
  //     account: otherAccount.publicKey,
  //     mint: mint.publicKey,
  //     user: Keypair.generate().publicKey,
  //     connection: provider.connection,
  //     payer: provider.wallet.publicKey,
  //   });

  //   await expect(
  //     program.methods
  //       .claim()
  //       .accounts({
  //         globalState,
  //         feeAccount,
  //         userTokenAccount: userTokenAccount.publicKey,
  //         yesTokenAccount: otherAccount.publicKey,
  //         noTokenAccount,
  //         userPosition,
  //         market: market.publicKey,
  //         authority,
  //         user: user.publicKey,
  //       })
  //       .preInstructions([...otherAccountIxs])
  //       .signers([user, otherAccount])
  //       .rpc(),
  //   ).rejects.toThrowAnchorError(ErrorCode.IncorrectYesEscrow);
  // });

  // it("fails to claim if the no token account provided is incorrect", async () => {
  //   expect.assertions(1);

  //   const otherAccount = Keypair.generate();
  //   const otherAccountIxs = await createInitAccountInstructions({
  //     account: otherAccount.publicKey,
  //     mint: mint.publicKey,
  //     user: Keypair.generate().publicKey,
  //     connection: provider.connection,
  //     payer: provider.wallet.publicKey,
  //   });

  //   await expect(
  //     program.methods
  //       .claim()
  //       .accounts({
  //         globalState,
  //         feeAccount,
  //         userTokenAccount: userTokenAccount.publicKey,
  //         yesTokenAccount,
  //         noTokenAccount: otherAccount.publicKey,
  //         userPosition,
  //         market: market.publicKey,
  //         authority,
  //         user: user.publicKey,
  //       })
  //       .preInstructions([...otherAccountIxs])
  //       .signers([user, otherAccount])
  //       .rpc(),
  //   ).rejects.toThrowAnchorError(ErrorCode.IncorrectNoEscrow);
  // });

  // it("fails to claim if the market has not finalized", async () => {
  //   expect.assertions(1);

  //   await expect(
  //     program.methods
  //       .claim()
  //       .accounts({
  //         globalState,
  //         feeAccount,
  //         userTokenAccount: userTokenAccount.publicKey,
  //         yesTokenAccount,
  //         noTokenAccount,
  //         userPosition,
  //         market: market.publicKey,
  //         authority,
  //         user: user.publicKey,
  //       })
  //       .signers([user])
  //       .rpc(),
  //   ).rejects.toThrowProgramError(ErrorCode.NotFinalized);
  // });
});
