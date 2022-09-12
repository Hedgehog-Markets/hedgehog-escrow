import type { InitializeMarketParams, Outcome } from "./utils";

import { LangErrorCode } from "@project-serum/anchor";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

import {
  intoU64BN,
  unixTimestamp,
  createInitMintInstructions,
  sendTx,
  __throw,
} from "../utils";

import {
  ErrorCode,
  program,
  interpretMarketResource,
  getAuthorityAddress,
  getYesTokenAccountAddress,
  getNoTokenAccountAddress,
} from "./utils";

const YES_AMOUNT = 1_000_000n;
const NO_AMOUNT = 2_000_000n;

describe("initialize market", () => {
  const mint = Keypair.generate();
  const resolver = Keypair.generate();

  let market: Keypair,
    authority: PublicKey,
    yesTokenAccount: PublicKey,
    yesTokenAccountNonce: number,
    noTokenAccount: PublicKey,
    noTokenAccountNonce: number;

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

  const initMarket = (params: Partial<InitializeMarketParams>) =>
    program.methods.initializeMarket(initMarketParams(params)).accounts({
      market: market.publicKey,
      authority,
      creator: program.provider.wallet.publicKey,
      tokenMint: mint.publicKey,
      yesTokenAccount,
      noTokenAccount,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
    });

  //////////////////////////////////////////////////////////////////////////////

  beforeAll(async () => {
    await sendTx(
      await createInitMintInstructions({
        mint,
        mintAuthority: program.provider.wallet.publicKey,
      }),
      [mint],
    );
  });

  beforeEach(async () => {
    market = Keypair.generate();

    authority = getAuthorityAddress(market);
    [yesTokenAccount, yesTokenAccountNonce] = getYesTokenAccountAddress(market);
    [noTokenAccount, noTokenAccountNonce] = getNoTokenAccountAddress(market);
  });

  //////////////////////////////////////////////////////////////////////////////

  it("successfully initializes market", async () => {
    expect.assertions(19);

    const params = initMarketParams({});

    await initMarket(params).signers([market]).rpc();

    const info = await program.account.market.fetch(market.publicKey);

    expect(info.creator).toEqualPubkey(program.provider.wallet.publicKey);
    expect(info.resolver).toEqualPubkey(resolver.publicKey);
    expect(info.tokenMint).toEqualPubkey(mint.publicKey);
    expect(info.yesTokenAccount).toEqualPubkey(yesTokenAccount);
    expect(info.noTokenAccount).toEqualPubkey(noTokenAccount);
    expect(info.yesAmount).toEqualBN(params.yesAmount);
    expect(info.yesFilled).toEqualBN(0);
    expect(info.noAmount).toEqualBN(params.noAmount);
    expect(info.noFilled).toEqualBN(0);
    expect(info.closeTs).toEqualBN(params.closeTs);
    expect(info.expiryTs).toEqualBN(params.expiryTs);
    expect(info.outcomeTs).toEqualBN(0);
    expect(info.resolutionDelay).toBe(params.resolutionDelay);
    expect(info.outcome).toStrictEqual<Outcome>({ Open: {} });
    expect(info.finalized).toBe(false);
    expect(info.yesAccountBump).toBe(yesTokenAccountNonce);
    expect(info.noAccountBump).toBe(noTokenAccountNonce);
    expect(info.acknowledged).toBe(false);
    expect(interpretMarketResource(info.uri)).toBe(params.uri);
  });

  it("fails if the authority is incorrect", async () => {
    expect.assertions(1);

    const wrongAuthority = Keypair.generate();

    await expect(
      initMarket({})
        .accounts({ authority: wrongAuthority.publicKey })
        .signers([market])
        .rpc(),
    ).rejects.toThrowProgramError(LangErrorCode.ConstraintSeeds);
  });

  it("fails if the yes token account is incorrect", async () => {
    expect.assertions(1);

    const wrongTokenAccount = Keypair.generate();

    // await expect(
    //   initMarket({})
    //     .accounts({ yesTokenAccount: wrongTokenAccount.publicKey })
    //     .signers([market])
    //     .rpc(),
    // ).rejects.toThrowProgramError(LangErrorCode.ConstraintSeeds);

    await expect(
      initMarket({})
        .accounts({ yesTokenAccount: wrongTokenAccount.publicKey })
        .signers([market])
        .rpc(),
    ).rejects.toThrow();
  });

  it("fails if the no token account is incorrect", async () => {
    expect.assertions(1);

    const wrongTokenAccount = Keypair.generate();

    // await expect(
    //   initMarket({})
    //     .accounts({ noTokenAccount: wrongTokenAccount.publicKey })
    //     .signers([market])
    //     .rpc(),
    // ).rejects.toThrowProgramError(LangErrorCode.ConstraintSeeds);

    await expect(
      initMarket({})
        .accounts({ noTokenAccount: wrongTokenAccount.publicKey })
        .signers([market])
        .rpc(),
    ).rejects.toThrow();
  });

  // it("fails if URI is too long", async () => {
  //   expect.assertions(1);

  //   await expect(
  //     initMarket({ uri: "0".repeat(201) })
  //       .signers([market])
  //       .rpc(),
  //   ).rejects.toThrowProgramError(ErrorCode.InvalidMarketResource);
  // });

  it("fails if close timestamp is before the current time", async () => {
    expect.assertions(1);

    await expect(
      initMarket({ closeTs: intoU64BN(0) })
        .signers([market])
        .rpc(),
    ).rejects.toThrowProgramError(ErrorCode.InvalidCloseTimestamp);
  });

  it("fails if expiry timestamp is before the close timestamp", async () => {
    expect.assertions(1);

    await expect(
      initMarket({ expiryTs: intoU64BN(0) })
        .signers([market])
        .rpc(),
    ).rejects.toThrowProgramError(ErrorCode.InvalidExpiryTimestamp);
  });

  it("fails if the yes amount is zero", async () => {
    expect.assertions(1);

    await expect(
      initMarket({ yesAmount: intoU64BN(0) })
        .signers([market])
        .rpc(),
    ).rejects.toThrowProgramError(ErrorCode.CannotHaveNonzeroAmounts);
  });

  it("fails if the no amount is zero", async () => {
    expect.assertions(1);

    await expect(
      initMarket({ noAmount: intoU64BN(0) })
        .signers([market])
        .rpc(),
    ).rejects.toThrowProgramError(ErrorCode.CannotHaveNonzeroAmounts);
  });
});
