import type { InitializeMarketParams } from "../hh-escrow/utils";
import type { IntoU64 } from "../utils";
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

describe("resolve nft floor resolver", () => {
  const mint = Keypair.generate();
  const market = Keypair.generate();

  const marketAuthority = getMarketAuthorityAddress(market);
  const [yesTokenAccount] = getYesTokenAccountAddress(market);
  const [noTokenAccount] = getNoTokenAccountAddress(market);

  const authority = Keypair.generate();
  const resolver = getNftFloorAddress(market);

  //////////////////////////////////////////////////////////////////////////////

  const resolveNftFloor = (currentFloorPrice?: IntoU64) =>
    program.methods
      .resolveNftFloor({ currentFloorPrice: intoU64BN(currentFloorPrice ?? 0) })
      .accounts({
        resolver,
        market: market.publicKey,
        authority: authority.publicKey,
        escrowProgram: escrowProgram.programId,
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

  it("fails if resolver is not market PDA", async () => {
    expect.assertions(1);

    const market = Keypair.generate();

    const marketAuthority = getMarketAuthorityAddress(market);
    const [yesTokenAccount] = getYesTokenAccountAddress(market);
    const [noTokenAccount] = getNoTokenAccountAddress(market);

    const preIxs = [];

    {
      const closeTs = unixTimestamp() + 3600n;
      const expiryTs = closeTs + 3600n;

      const params: InitializeMarketParams = {
        closeTs: intoU64BN(closeTs),
        expiryTs: intoU64BN(expiryTs),
        resolutionDelay: 3600,
        yesAmount: intoU64BN(YES_AMOUNT),
        noAmount: intoU64BN(NO_AMOUNT),
        resolver: marketAuthority,
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

    await expect(
      resolveNftFloor()
        .accounts({ resolver, market: market.publicKey })
        .preInstructions(preIxs)
        .signers([market, authority])
        .rpc(),
    ).rejects.toThrowProgramError(LangErrorCode.ConstraintSeeds);
  });

  it("fails if authority is incorrect", async () => {
    expect.assertions(1);

    const wrongAuthority = Keypair.generate();

    await expect(
      resolveNftFloor()
        .accounts({ authority: wrongAuthority.publicKey })
        .signers([wrongAuthority])
        .rpc(),
    ).rejects.toThrowProgramError(ErrorCode.IncorrectAuthority);
  });

  it("fails if expire timestamp has not passed", async () => {
    expect.assertions(1);

    await expect(
      resolveNftFloor().signers([authority]).rpc(),
    ).rejects.toThrowProgramError(ErrorCode.TimestampNotPassed);
  });
});
