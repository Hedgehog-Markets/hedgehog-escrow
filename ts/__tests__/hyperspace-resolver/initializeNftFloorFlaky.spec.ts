import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";

import {
  program as escrowProgram,
  getAuthorityAddress as getMarketAuthorityAddress,
  getNoTokenAccountAddress,
  getYesTokenAccountAddress,
} from "@/hh-escrow";
import { ErrorCode, getNftFloorAddress, program } from "@/hyperspace-resolver";
import {
  SKIP_FLAKY,
  chain,
  createInitMintInstructions,
  intoU64BN,
  sendTx,
  unixTimestamp,
} from "@/utils";

import type { InitializeMarketParams } from "@/hh-escrow";
import type { InitializeNftFloorParams } from "@/hyperspace-resolver";

const YES_AMOUNT = 1_000_000n;
const NO_AMOUNT = 2_000_000n;

const describeFlaky = SKIP_FLAKY ? describe.skip : describe;

describeFlaky("initialize nft floor resolver", () => {
  const mint = Keypair.generate();
  const authority = Keypair.generate();

  let market: Keypair,
    marketAuthority: PublicKey,
    yesTokenAccount: PublicKey,
    noTokenAccount: PublicKey,
    resolver: PublicKey;

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

    marketAuthority = getMarketAuthorityAddress(market);
    [yesTokenAccount] = getYesTokenAccountAddress(market);
    [noTokenAccount] = getNoTokenAccountAddress(market);

    resolver = getNftFloorAddress(market);
  });

  //////////////////////////////////////////////////////////////////////////////

  it("fails if expire timestamp has passed", async () => {
    expect.assertions(1);

    const time = await chain.blockTimestamp();
    const expiryTs = time + 2;

    await initMarket({
      closeTs: intoU64BN(expiryTs),
      expiryTs: intoU64BN(expiryTs),
    })
      .signers([market])
      .rpc();

    await chain.sleepUntil(expiryTs);

    await expect(initNftFloor({}).rpc()).rejects.toThrowProgramError(ErrorCode.TimestampPassed);
  });
});
