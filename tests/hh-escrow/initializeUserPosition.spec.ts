import { getUserPositionAddress, InitializeMarketParams } from "./utils";

import { Keypair, SystemProgram } from "@solana/web3.js";

import {
  intoU64BN,
  unixTimestamp,
  createInitMintInstructions,
  __throw,
} from "../utils";

import {
  program,
  getAuthorityAddress,
  getYesTokenAccountAddress,
  getNoTokenAccountAddress,
} from "./utils";

const YES_AMOUNT = 1_000_000n;
const NO_AMOUNT = 2_000_000n;

describe("initialize user position", () => {
  const market = Keypair.generate();
  const mint = Keypair.generate();
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

    const preIxs = await createInitMintInstructions({
      mint,
      mintAuthority: program.provider.wallet.publicKey,
    });

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
      .signers([mint, market])
      .rpc();
  });

  //////////////////////////////////////////////////////////////////////////////

  it("successfully initializes a user position", async () => {
    expect.assertions(3);

    const user = Keypair.generate();
    const userPosition = getUserPositionAddress(user, market);

    await program.methods
      .initializeUserPosition()
      .accounts({
        userPosition,
        market: market.publicKey,
        user: user.publicKey,
        payer: program.provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([user])
      .rpc();

    const info = await program.account.userPosition.fetch(userPosition);

    expect(info.market).toEqualPubkey(market.publicKey);
    expect(info.yesAmount).toEqualBN(0n);
    expect(info.noAmount).toEqualBN(0n);
  });

  it("fails if the seeds are incorrect", async () => {
    expect.assertions(1);

    const user = Keypair.generate();
    const wrongUser = Keypair.generate();
    const wrongUserPosition = getUserPositionAddress(wrongUser, market);

    await expect(
      program.methods
        .initializeUserPosition()
        .accounts({
          userPosition: wrongUserPosition,
          market: market.publicKey,
          user: user.publicKey,
          payer: program.provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc(),
    ).rejects.toThrow(
      "Cross-program invocation with unauthorized signer or writable account",
    );
  });
});
