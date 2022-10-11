import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Keypair, PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";

import {
  program as escrowProgram,
  getAuthorityAddress as getMarketAuthorityAddress,
  getNoTokenAccountAddress,
  getUserPositionAddress,
  getYesTokenAccountAddress,
} from "@/hh-escrow";
import { getNftFloorAddress, program } from "@/hyperspace-resolver";
import {
  SKIP_FLAKY,
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

import type { InitializeMarketParams, Outcome } from "@/hh-escrow";
import type { InitializeNftFloorParams } from "@/hyperspace-resolver";
import type { IntoU64 } from "@/utils";

const YES_AMOUNT = intoU64BN(100n);
const NO_AMOUNT = intoU64BN(200n);

const TOP_OFF = 500n;

const describeFlaky = SKIP_FLAKY ? describe.skip : describe;

describeFlaky("initialize nft floor resolver", () => {
  const mint = Keypair.generate();
  const user = Keypair.generate();
  const userTokenAccount = Keypair.generate();
  const authority = Keypair.generate();

  let market: Keypair,
    marketAuthority: PublicKey,
    yesTokenAccount: PublicKey,
    noTokenAccount: PublicKey,
    userPosition: PublicKey,
    resolver: PublicKey;

  let userPositionIx: TransactionInstruction, depositIx: TransactionInstruction;

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
    yesAmount ??= YES_AMOUNT;
    noAmount ??= NO_AMOUNT;
    resolver_ ??= resolver;
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
    escrowProgram.methods.initializeMarket(initMarketParams(params)).accounts({
      market: market.publicKey,
      authority: marketAuthority,
      creator: program.provider.wallet.publicKey,
      tokenMint: mint.publicKey,
      yesTokenAccount,
      noTokenAccount,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
    });

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

  const resolveNftFloor = (currentFloorPrice: IntoU64 | null) =>
    program.methods
      .resolveNftFloor({
        currentFloorPrice: currentFloorPrice === null ? null : intoU64BN(currentFloorPrice),
      })
      .accounts({
        resolver,
        market: market.publicKey,
        authority: authority.publicKey,
        escrowProgram: escrowProgram.programId,
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

    marketAuthority = getMarketAuthorityAddress(market);
    [yesTokenAccount] = getYesTokenAccountAddress(market);
    [noTokenAccount] = getNoTokenAccountAddress(market);
    userPosition = getUserPositionAddress(user, market);

    resolver = getNftFloorAddress(market);

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

    userPositionIx = await escrowProgram.methods
      .initializeUserPosition()
      .accounts({
        userPosition,
        market: market.publicKey,
        user: user.publicKey,
        payer: program.provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .instruction();

    depositIx = await escrowProgram.methods
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
    { case: "less than", resolves: "no", outcome: { No: {} }, diff: -1n },
    { case: "equal", resolves: "yes", outcome: { Yes: {} }, diff: 0n },
    { case: "greater than", resolves: "yes", outcome: { Yes: {} }, diff: 1n },
    { case: "none", resolves: "invalid", outcome: { Invalid: {} }, diff: null },
  ])("successfully resolves to $resolves ($case)", async ({ outcome, diff }) => {
    expect.assertions(3);

    const expiryTs = (await chain.blockTimestamp()) + 2;

    const floorPrice = 100n;

    const initMarketIx = await initMarket({
      closeTs: intoU64BN(expiryTs),
      expiryTs: intoU64BN(expiryTs),
    }).instruction();

    await initNftFloor({ floorPrice: intoU64BN(floorPrice) })
      .preInstructions([initMarketIx, userPositionIx, depositIx])
      .signers([market, user])
      .rpc();

    await chain.sleepUntil(expiryTs);

    await resolveNftFloor(diff === null ? null : floorPrice + diff)
      .signers([authority])
      .rpc();

    const info = await escrowProgram.account.market.fetch(market.publicKey);
    const time = intoU64(await chain.blockTimestamp());

    expect(info.outcome).toStrictEqual<Outcome>(outcome);

    const outcomeTs = intoU64(info.outcomeTs);
    expect(outcomeTs).toBeGreaterThan(0n);
    expect(outcomeTs).toBeLessThanOrEqual(time);
  });
});
