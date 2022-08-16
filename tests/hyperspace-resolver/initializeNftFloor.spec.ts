import type { InitializeMarketParams } from "../hh-escrow/utils";
import type { InitializeNftFloorParams } from "./utils";

import { LangErrorCode } from "@project-serum/anchor";
import { Keypair, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

import { intoU64BN, unixTimestamp, createInitMintInstructions } from "../utils";
import {
  program as escrowProgram,
  getAuthorityAddress as getMarketAuthorityAddress,
  getYesTokenAccountAddress,
  getNoTokenAccountAddress,
} from "../hh-escrow/utils";

import { ErrorCode, program, getNftFloorAddress } from "./utils";

const YES_AMOUNT = 1_000_000n;
const NO_AMOUNT = 2_000_000n;

describe("initialize nft floor resolver", () => {
  const market = Keypair.generate();
  const mint = Keypair.generate();

  const marketAuthority = getMarketAuthorityAddress(market);
  const [yesTokenAccount] = getYesTokenAccountAddress(market);
  const [noTokenAccount] = getNoTokenAccountAddress(market);

  const authority = Keypair.generate();
  const resolver = getNftFloorAddress(market);

  //////////////////////////////////////////////////////////////////////////////

  const initNftFloorParams = ({
    authority: authority_,
    floorPrice,
    projectId,
  }: Partial<InitializeNftFloorParams>): InitializeNftFloorParams => {
    authority_ ??= authority.publicKey;
    floorPrice ??= intoU64BN(0);
    projectId ??= "";

    return {
      authority: authority_,
      floorPrice,
      projectId,
    };
  };

  const initNftFloor = (params: Partial<InitializeNftFloorParams>) =>
    program.methods.initializeNftFloor(initNftFloorParams(params)).accounts({
      resolver,
      market: market.publicKey,
      creator: program.provider.wallet.publicKey,
      escrowProgram: escrowProgram.programId,
      systemProgram: SystemProgram.programId,
    });

  //////////////////////////////////////////////////////////////////////////////

  beforeAll(async () => {
    const preIxs = await createInitMintInstructions({
      mint,
      mintAuthority: program.provider.wallet.publicKey,
    });

    const closeTs = unixTimestamp() + 3600n;
    const expiryTs = closeTs + 3600n;

    const params: InitializeMarketParams = {
      closeTs: intoU64BN(closeTs),
      expiryTs: intoU64BN(expiryTs),
      resolutionDelay: 3600,
      yesAmount: intoU64BN(YES_AMOUNT),
      noAmount: intoU64BN(NO_AMOUNT),
      resolver,
      uri: "0".repeat(200),
    };

    await escrowProgram.methods
      .initializeMarket(params)
      .accounts({
        market: market.publicKey,
        authority: marketAuthority,
        creator: program.provider.wallet.publicKey,
        tokenMint: mint.publicKey,
        yesTokenAccount,
        noTokenAccount,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .preInstructions(preIxs)
      .signers([mint, market])
      .rpc();
  });

  //////////////////////////////////////////////////////////////////////////////

  it("fails if resolver is incorrect", async () => {
    expect.assertions(1);

    const market = Keypair.generate();

    const marketAuthority = getMarketAuthorityAddress(market);
    const [yesTokenAccount] = getYesTokenAccountAddress(market);
    const [noTokenAccount] = getNoTokenAccountAddress(market);

    const resolver = getNftFloorAddress(market);

    const wrongResolver = Keypair.generate();

    const closeTs = unixTimestamp() + 3600n;
    const expiryTs = closeTs + 3600n;

    const params: InitializeMarketParams = {
      closeTs: intoU64BN(closeTs),
      expiryTs: intoU64BN(expiryTs),
      resolutionDelay: 3600,
      yesAmount: intoU64BN(YES_AMOUNT),
      noAmount: intoU64BN(NO_AMOUNT),
      resolver: wrongResolver.publicKey,
      uri: "0".repeat(200),
    };

    await escrowProgram.methods
      .initializeMarket(params)
      .accounts({
        market: market.publicKey,
        authority: marketAuthority,
        creator: program.provider.wallet.publicKey,
        tokenMint: mint.publicKey,
        yesTokenAccount,
        noTokenAccount,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([market])
      .rpc();

    await expect(
      initNftFloor({}).accounts({ resolver, market: market.publicKey }).rpc(),
    ).rejects.toThrowProgramError(ErrorCode.IncorrectResolver);
  });

  it("fails if resolver is not market PDA", async () => {
    expect.assertions(1);

    const wrongResolver = Keypair.generate();

    await expect(
      initNftFloor({}).accounts({ resolver: wrongResolver.publicKey }).rpc(),
    ).rejects.toThrowProgramError(LangErrorCode.ConstraintSeeds);
  });

  it("fails if creator is incorrect", async () => {
    expect.assertions(1);

    const wrongResolver = Keypair.generate();

    await expect(
      initNftFloor({}).accounts({ resolver: wrongResolver.publicKey }).rpc(),
    ).rejects.toThrowProgramError(LangErrorCode.ConstraintSeeds);
  });

  it("successfully initializes nft floor resolver", async () => {
    expect.assertions(6);

    const floorPrice = intoU64BN(42);
    const projectId = "foobar";

    let { acknowledged } = await escrowProgram.account.market.fetch(
      market.publicKey,
    );

    expect(acknowledged).toBe(false);

    try {
      await initNftFloor({ floorPrice, projectId }).rpc();
    } catch (err) {
      console.error(err);
      throw err;
    }

    const info = await program.account.nftFloor.fetch(resolver);

    expect(info.market).toEqualPubkey(market.publicKey);
    expect(info.authority).toEqualPubkey(authority.publicKey);
    expect(info.floorPrice).toEqualBN(floorPrice);
    expect(info.projectId).toBe(projectId);

    ({ acknowledged } = await escrowProgram.account.market.fetch(
      market.publicKey,
    ));

    expect(acknowledged).toBe(true);
  });
});
