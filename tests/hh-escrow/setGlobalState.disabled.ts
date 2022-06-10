// Because these tests require the presence of program data, they should be run
// using a separate test validator (`anchor test` injects the program directly
// instead of deploying, and hence does not initialize program data).
//
// Because of this, these tests require a different set up. To run these tests:
//
// 1. Clear any existing ledger (usually located in `test-ledger`)
// 2. Start a local validator with `$ solana-test-validator`.
// 3. Set the solana cluster to localnet with `solana config set --url
//    [validator url]`.
// 4. Run `anchor run pre_test_deploy && anchor test --skip-deploy --skip-build
//    --skip-local-validator [filter]`.
// 5. Shut down the validator once tests are complete.
import * as anchor from '@project-serum/anchor';
import type { Program } from '@project-serum/anchor';
import {
  Keypair,
  PublicKey,
  SystemProgram,
} from '@solana/web3.js';
import type { HhEscrow } from '../../target/types/hh_escrow';
import { ErrorCode } from './utils';

describe('hh-escrow global state testing', () => {
  const provider = anchor.Provider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.HhEscrow as Program<HhEscrow>;
  const programDataAddress = PublicKey.findProgramAddressSync(
    [program.programId.toBytes()],
    new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111')
  )[0];
  const [globalState] = PublicKey.findProgramAddressSync(
    [Buffer.from('global')],
    program.programId
  );
  const feeWallet = Keypair.generate();
  const globalStateOwner = Keypair.generate();

  beforeAll(async () => {
    await program.methods
      .initializeGlobalState({ protocolFeeBps: 10_000 })
      .accounts({
        globalState,
        feeWallet: feeWallet.publicKey,
        globalStateOwner: globalStateOwner.publicKey,
        authority: provider.wallet.publicKey,
        escrowProgram: program.programId,
        programData: programDataAddress,
        systemProgram: SystemProgram.programId,
        payer: program.provider.wallet.publicKey,
      })
      .rpc();
  });

  it('fails if the incorrect authority is provided', async () => {
    expect.assertions(1);

    const wrongAddress = Keypair.generate();
    await expect(
      program.methods
        .setGlobalState({
          newFeeCutBps: 10_000,
          newFeeWallet: feeWallet.publicKey,
          newOwner: globalStateOwner.publicKey,
        })
        .accounts({
          globalState,
          owner: wrongAddress.publicKey,
        })
        .signers([wrongAddress])
        .rpc()
    ).rejects.toThrowAnchorError(ErrorCode.IncorrectGlobalStateOwner);
  });

  it('fails if the authority does not sign the change', async () => {
    expect.assertions(1);

    await expect(
      program.methods
        .setGlobalState({
          newFeeCutBps: 10_000,
          newFeeWallet: feeWallet.publicKey,
          newOwner: globalStateOwner.publicKey,
        })
        .accounts({
          globalState,
          owner: globalStateOwner.publicKey,
        })
        .rpc()
    ).rejects.toThrow();
  });

  it('fails if the fee provided is too high', async () => {
    expect.assertions(1);

    await expect(
      program.methods
        .setGlobalState({
          newFeeCutBps: 10_001,
          newFeeWallet: feeWallet.publicKey,
          newOwner: globalStateOwner.publicKey,
        })
        .accounts({
          globalState,
          owner: globalStateOwner.publicKey,
        })
        .signers([globalStateOwner])
        .rpc()
    ).rejects.toThrowProgramError(ErrorCode.FeeTooHigh);
  });

  it('changes the global state correctly', async () => {
    expect.assertions(3);

    const newWallet = Keypair.generate().publicKey;
    const newOwner = Keypair.generate().publicKey;
    await program.methods
      .setGlobalState({
        newFeeCutBps: 9_000,
        newFeeWallet: newWallet,
        newOwner: newOwner,
      })
      .accounts({
        globalState,
        owner: globalStateOwner.publicKey,
      })
      .signers([globalStateOwner])
      .rpc();

    const globalStateAccount = await program.account.globalState.fetch(
      globalState
    );

    expect(globalStateAccount.owner).toEqualPubkey(newOwner);
    expect(globalStateAccount.feeWallet).toEqualPubkey(newWallet);
    expect(globalStateAccount.feeCutBps.bps).toBe(9_000);
  });
});
