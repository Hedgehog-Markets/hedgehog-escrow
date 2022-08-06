import { Keypair, SystemProgram } from "@solana/web3.js";

import { ErrorCode, program, programData, globalState } from "./utils";

describe.skip("initialize global state", () => {
  const authority = globalState.authority;
  const feeWallet = Keypair.generate();

  it("fails if the upgrade authority is incorrect", async () => {
    expect.assertions(1);

    const wrongUgradeAuthority = Keypair.generate();

    await expect(
      program.methods
        .initializeGlobalState({
          authority: authority.publicKey,
          feeWallet: feeWallet.publicKey,
          protocolFeeBps: 10,
        })
        .accounts({
          globalState: globalState.address,
          payer: program.provider.wallet.publicKey,
          upgradeAuthority: wrongUgradeAuthority.publicKey,
          escrowProgram: program.programId,
          programData,
          systemProgram: SystemProgram.programId,
        })
        .signers([wrongUgradeAuthority])
        .rpc(),
    ).rejects.toThrowProgramError(ErrorCode.InvalidProgramUpgradeAuthority);
  });

  it("fails if the protocol fee is too high", async () => {
    expect.assertions(1);

    await expect(
      program.methods
        .initializeGlobalState({
          authority: authority.publicKey,
          feeWallet: feeWallet.publicKey,
          protocolFeeBps: 10_001,
        })
        .accounts({
          globalState: globalState.address,
          payer: program.provider.wallet.publicKey,
          upgradeAuthority: program.provider.wallet.publicKey,
          escrowProgram: program.programId,
          programData,
          systemProgram: SystemProgram.programId,
        })
        .rpc(),
    ).rejects.toThrowProgramError(ErrorCode.FeeTooHigh);
  });

  it("initializes the global state", async () => {
    expect.assertions(3);

    await program.methods
      .initializeGlobalState({
        authority: authority.publicKey,
        feeWallet: feeWallet.publicKey,
        protocolFeeBps: 10_000,
      })
      .accounts({
        globalState: globalState.address,
        payer: program.provider.wallet.publicKey,
        upgradeAuthority: program.provider.wallet.publicKey,
        escrowProgram: program.programId,
        programData,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const state = await program.account.globalState.fetch(globalState.address);

    expect(state.authority).toEqualPubkey(authority.publicKey);
    expect(state.feeWallet).toEqualPubkey(feeWallet.publicKey);
    expect(state.protocolFeeBps.bps).toBe(10_000);
  });
});
