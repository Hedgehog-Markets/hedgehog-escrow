import { Keypair } from "@solana/web3.js";

import { ErrorCode, globalState, program } from "@/hh-escrow";

describe("set global state", () => {
  const authority = globalState.authority;

  beforeAll(async () => {
    // Ensure global state is initialized and matches expected state.
    await globalState.initialize();
  });

  it("fails if the authority is incorrect", async () => {
    expect.assertions(1);

    const wrongAuthority = Keypair.generate();

    const { feeWallet, protocolFeeBps } = await globalState.fetch();

    await expect(
      program.methods
        .setGlobalState({
          newOwner: authority.publicKey,
          newFeeWallet: feeWallet,
          newFeeCutBps: protocolFeeBps.bps,
        })
        .accounts({
          globalState: globalState.address,
          owner: wrongAuthority.publicKey,
        })
        .signers([wrongAuthority])
        .rpc(),
    ).rejects.toThrowProgramError(ErrorCode.IncorrectGlobalStateOwner);
  });

  it("fails if the protocol fee is too high", async () => {
    expect.assertions(1);

    const feeWallet = await globalState.getFeeWallet();

    await expect(
      program.methods
        .setGlobalState({
          newOwner: authority.publicKey,
          newFeeWallet: feeWallet,
          newFeeCutBps: 10_001,
        })
        .accounts({
          globalState: globalState.address,
          owner: authority.publicKey,
        })
        .signers([authority])
        .rpc(),
    ).rejects.toThrowProgramError(ErrorCode.FeeTooHigh);
  });

  it("successfully changes the global state", async () => {
    expect.assertions(3);

    const { feeWallet, protocolFeeBps } = await globalState.fetch();

    const newAuthority = Keypair.generate();
    const newFeeWallet = Keypair.generate();
    const newProtocolFeeBps = protocolFeeBps.bps === 1000 ? 2000 : 1000;

    await program.methods
      .setGlobalState({
        newOwner: newAuthority.publicKey,
        newFeeWallet: newFeeWallet.publicKey,
        newFeeCutBps: newProtocolFeeBps,
      })
      .accounts({
        globalState: globalState.address,
        owner: authority.publicKey,
      })
      .signers([authority])
      .rpc();

    try {
      const state = await globalState.fetch();

      expect(state.authority).toEqualPubkey(newAuthority.publicKey);
      expect(state.feeWallet).toEqualPubkey(newFeeWallet.publicKey);
      expect(state.protocolFeeBps.bps).toBe(newProtocolFeeBps);
    } finally {
      // Restore the previous global state, to have minimal impact on other tests.
      await program.methods
        .setGlobalState({
          newOwner: authority.publicKey,
          newFeeWallet: feeWallet,
          newFeeCutBps: protocolFeeBps.bps,
        })
        .accounts({
          globalState: globalState.address,
          owner: newAuthority.publicKey,
        })
        .signers([newAuthority])
        .rpc();
    }
  });
});
