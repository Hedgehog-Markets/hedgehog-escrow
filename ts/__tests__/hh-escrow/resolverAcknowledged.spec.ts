import { Keypair } from "@solana/web3.js";

import {
  ErrorCode,
  getAuthorityAddress,
  getNoTokenAccountAddress,
  getYesTokenAccountAddress,
  program,
} from "@/hh-escrow";
import {
  __throw,
  createInitAccountInstructions,
  createInitMintInstructions,
  intoU64BN,
  unixTimestamp,
} from "@/utils";

import type { InitializeMarketParams } from "@/hh-escrow";

const YES_AMOUNT = 1_000_000n;
const NO_AMOUNT = 2_000_000n;

describe("resolver acknowledged", () => {
  const market = Keypair.generate();
  const mint = Keypair.generate();
  const user = Keypair.generate();
  const userTokenAccount = Keypair.generate();
  const resolver = Keypair.generate();

  const authority = getAuthorityAddress(market);
  const [yesTokenAccount] = getYesTokenAccountAddress(market);
  const [noTokenAccount] = getNoTokenAccountAddress(market);

  //////////////////////////////////////////////////////////////////////////////

  beforeAll(async () => {
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

    const preIxs = [
      ...(await createInitMintInstructions({
        mint,
        mintAuthority: program.provider.wallet.publicKey,
      })),
      ...(await createInitAccountInstructions({
        account: userTokenAccount,
        mint,
        user,
      })),
    ];

    await program.methods
      .initializeMarket(params)
      .accounts({
        market: market.publicKey,
        tokenMint: mint.publicKey,
        authority,
        yesTokenAccount,
        noTokenAccount,
      })
      .preInstructions(preIxs)
      .signers([mint, userTokenAccount, market])
      .rpc();
  });

  //////////////////////////////////////////////////////////////////////////////

  it("fails if the incorrect resolver is provided", async () => {
    expect.assertions(1);

    const wrongResolver = Keypair.generate();

    await expect(
      program.methods
        .resolverAcknowledge()
        .accounts({
          market: market.publicKey,
          resolver: wrongResolver.publicKey,
        })
        .signers([wrongResolver])
        .rpc(),
    ).rejects.toThrowProgramError(ErrorCode.IncorrectResolver);
  });

  it("successfully acknowledges the market", async () => {
    expect.assertions(1);

    await program.methods
      .resolverAcknowledge()
      .accounts({
        market: market.publicKey,
        resolver: resolver.publicKey,
      })
      .signers([resolver])
      .rpc();

    const info = await program.account.market.fetch(market.publicKey);

    expect(info.acknowledged).toBe(true);
  });
});
