import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Keypair, SystemProgram } from "@solana/web3.js";

import {
  program as escrowProgram,
  getAuthorityAddress as getMarketAuthorityAddress,
  getNoTokenAccountAddress,
  getYesTokenAccountAddress,
} from "@/hh-escrow";
import { ErrorCode, getNftFloorAddress, program } from "@/hyperspace-resolver";
import { createInitMintInstructions, intoU64BN, unixTimestamp } from "@/utils";

import type { InitializeMarketParams } from "@/hh-escrow";
import type { InitializeNftFloorParams } from "@/hyperspace-resolver";

const YES_AMOUNT = 1_000_000n;
const NO_AMOUNT = 2_000_000n;

describe("acknowledge nft floor resolver", () => {
  const mint = Keypair.generate();
  const market = Keypair.generate();

  const marketAuthority = getMarketAuthorityAddress(market);
  const [yesTokenAccount] = getYesTokenAccountAddress(market);
  const [noTokenAccount] = getNoTokenAccountAddress(market);

  const authority = Keypair.generate();
  const resolver = getNftFloorAddress(market);

  //////////////////////////////////////////////////////////////////////////////

  const acknowledgeNftFloor = () =>
    program.methods.acknowledgeNftFloor().accounts({
      resolver,
      authority: authority.publicKey,
    });

  //////////////////////////////////////////////////////////////////////////////

  beforeAll(async () => {
    const preIxs = await createInitMintInstructions({
      mint,
      mintAuthority: program.provider.wallet.publicKey,
    });

    {
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

      preIxs.push(
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
          .instruction(),
      );
    }

    {
      const params: InitializeNftFloorParams = {
        authority: authority.publicKey,
        floorPrice: intoU64BN(0),
        projectId: "",
      };

      await program.methods
        .initializeNftFloor(params)
        .accounts({
          resolver,
          market: market.publicKey,
          creator: program.provider.wallet.publicKey,
          escrowProgram: escrowProgram.programId,
          systemProgram: SystemProgram.programId,
        })
        .preInstructions(preIxs)
        .signers([mint, market])
        .rpc();
    }
  });

  //////////////////////////////////////////////////////////////////////////////

  it("fails if authority is incorrect", async () => {
    expect.assertions(1);

    const wrongAuthority = Keypair.generate();

    await expect(
      acknowledgeNftFloor()
        .accounts({ authority: wrongAuthority.publicKey })
        .signers([wrongAuthority])
        .rpc(),
    ).rejects.toThrowProgramError(ErrorCode.IncorrectAuthority);
  });

  it("successfully acknowledges resolver", async () => {
    expect.assertions(2);

    let info = await program.account.nftFloor.fetch(resolver);

    expect(info.acknowledged).toBe(false);

    await acknowledgeNftFloor().signers([authority]).rpc();

    info = await program.account.nftFloor.fetch(resolver);

    expect(info.acknowledged).toBe(true);
  });

  it("fails if already acknowledged", async () => {
    expect.assertions(2);

    let info = await program.account.nftFloor.fetch(resolver);
    if (!info.acknowledged) {
      try {
        await acknowledgeNftFloor().signers([authority]).rpc();
      } catch (err) {
        // noop
      }
    }
    info = await program.account.nftFloor.fetch(resolver);

    expect(info.acknowledged).toBe(true);

    await expect(acknowledgeNftFloor().signers([authority]).rpc()).rejects.toThrowProgramError(
      ErrorCode.AlreadyAcknowledged,
    );
  });
});
