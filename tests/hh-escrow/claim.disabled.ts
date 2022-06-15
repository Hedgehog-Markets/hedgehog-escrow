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
import { Program, LangErrorCode } from '@project-serum/anchor';
import {
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddress,
} from '@solana/spl-token';
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import type { HhEscrow } from '../../target/types/hh_escrow';
import { intoU64BN } from '../u64';
import {
  createInitAccountInstructions,
  createInitMintInstructions,
} from '../utils';
import { ErrorCode, InitializeMarketParams } from './utils';

// These test shouldn't be flaky since they hit failures that can be
// consistently set without worrying about the clock.
describe('hh-escrow claim failure tests', () => {
  const YES_AMOUNT = 1_000_000;
  const NO_AMOUNT = 2_000_000;

  // Configure the client to use the local cluster.
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

  // Parameters.
  const closeTs = BigInt(Date.now()) / 1000n + 3600n;
  const expiryTs = closeTs + 3600n;
  const resolver = Keypair.generate();
  const defaultMarketParams: InitializeMarketParams = {
    closeTs: intoU64BN(closeTs),
    expiryTs: intoU64BN(expiryTs),
    resolutionDelay: 3600,
    yesAmount: intoU64BN(YES_AMOUNT),
    noAmount: intoU64BN(NO_AMOUNT),
    resolver: resolver.publicKey,
    uri: '0'.repeat(256),
  };

  // Accounts.
  const mint = Keypair.generate();
  const user = Keypair.generate();
  const userTokenAccount = Keypair.generate();
  let market: Keypair,
    authority: PublicKey,
    feeAccount: PublicKey,
    yesTokenAccount: PublicKey,
    noTokenAccount: PublicKey,
    userPosition: PublicKey;

  // Instructions.
  let initializeIx: TransactionInstruction;

  beforeAll(async () => {
    await program.methods
      .initializeGlobalState({ protocolFeeBps: 123 })
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

    const mintIxs = await createInitMintInstructions({
      mint: mint.publicKey,
      mintAuthority: provider.wallet.publicKey,
      connection: provider.connection,
      payer: provider.wallet.publicKey,
    });
    const userTokenAccountIxs = await createInitAccountInstructions({
      account: userTokenAccount.publicKey,
      mint: mint.publicKey,
      user: user.publicKey,
      connection: provider.connection,
      payer: provider.wallet.publicKey,
    });
    feeAccount = await getAssociatedTokenAddress(
      mint.publicKey,
      feeWallet.publicKey
    );
    const feeTokenAccountIx = await createAssociatedTokenAccountInstruction(
      provider.wallet.publicKey,
      feeAccount,
      feeWallet.publicKey,
      mint.publicKey
    );

    await provider.send(
      new Transaction().add(
        ...mintIxs,
        ...userTokenAccountIxs,
        feeTokenAccountIx
      ),
      [mint, userTokenAccount]
    );

    market = Keypair.generate();
    [authority] = PublicKey.findProgramAddressSync(
      [Buffer.from('authority'), market.publicKey.toBuffer()],
      program.programId
    );
    [yesTokenAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from('yes'), market.publicKey.toBuffer()],
      program.programId
    );
    [noTokenAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from('no'), market.publicKey.toBuffer()],
      program.programId
    );
    [userPosition] = PublicKey.findProgramAddressSync(
      [
        Buffer.from('user'),
        user.publicKey.toBuffer(),
        market.publicKey.toBuffer(),
      ],
      program.programId
    );

    initializeIx = await program.methods
      .initializeMarket(defaultMarketParams)
      .accounts({
        market: market.publicKey,
        tokenMint: mint.publicKey,
        authority,
        yesTokenAccount,
        noTokenAccount,
      })
      .instruction();
    await program.methods
      .initializeUserPosition()
      .accounts({
        user: user.publicKey,
        market: market.publicKey,
        userPosition,
      })
      .preInstructions([initializeIx])
      .signers([market, user])
      .rpc();
  });

  it('fails to claim if the provided global state is incorrect', async () => {
    expect.assertions(1);

    const [otherGlobalState] = PublicKey.findProgramAddressSync(
      [Buffer.from('globals')],
      program.programId
    );

    await expect(
      program.methods
        .claim()
        .accounts({
          globalState: otherGlobalState,
          feeAccount,
          userTokenAccount: userTokenAccount.publicKey,
          yesTokenAccount,
          noTokenAccount,
          userPosition,
          market: market.publicKey,
          authority,
          user: user.publicKey,
        })
        .signers([user])
        .rpc()
    ).rejects.toThrow();
  });

  it('fails to claim if the provided fee account is not owned by the fee wallet', async () => {
    expect.assertions(1);

    const otherAccount = Keypair.generate();
    const otherAccountIxs = await createInitAccountInstructions({
      account: otherAccount.publicKey,
      mint: mint.publicKey,
      user: Keypair.generate().publicKey,
      connection: provider.connection,
      payer: provider.wallet.publicKey,
    });

    await expect(
      program.methods
        .claim()
        .accounts({
          globalState,
          feeAccount: otherAccount.publicKey,
          userTokenAccount: userTokenAccount.publicKey,
          yesTokenAccount,
          noTokenAccount,
          userPosition,
          market: market.publicKey,
          authority,
          user: user.publicKey,
        })
        .preInstructions([...otherAccountIxs])
        .signers([user, otherAccount])
        .rpc()
    ).rejects.toThrowAnchorError(ErrorCode.AccountNotOwnedByFeeWallet);
  });

  it('fails to claim if the provided fee account is not the associated token account', async () => {
    expect.assertions(1);

    const otherAccount = Keypair.generate();
    const otherAccountIxs = await createInitAccountInstructions({
      account: otherAccount.publicKey,
      mint: mint.publicKey,
      user: feeWallet.publicKey,
      connection: provider.connection,
      payer: provider.wallet.publicKey,
    });

    await expect(
      program.methods
        .claim()
        .accounts({
          globalState,
          feeAccount: otherAccount.publicKey,
          userTokenAccount: userTokenAccount.publicKey,
          yesTokenAccount,
          noTokenAccount,
          userPosition,
          market: market.publicKey,
          authority,
          user: user.publicKey,
        })
        .preInstructions([...otherAccountIxs])
        .signers([user, otherAccount])
        .rpc()
    ).rejects.toThrowProgramError(ErrorCode.AssociatedTokenAccountRequired);
  });

  it('fails to claim if the user provides the yes/no token account', async () => {
    expect.assertions(2);

    await expect(
      program.methods
        .claim()
        .accounts({
          globalState,
          feeAccount,
          userTokenAccount: yesTokenAccount,
          yesTokenAccount,
          noTokenAccount,
          userPosition,
          market: market.publicKey,
          authority,
          user: user.publicKey,
        })
        .signers([user])
        .rpc()
    ).rejects.toThrowAnchorError(ErrorCode.UserAccountCannotBeMarketAccount);

    await expect(
      program.methods
        .claim()
        .accounts({
          globalState,
          feeAccount,
          userTokenAccount: noTokenAccount,
          yesTokenAccount,
          noTokenAccount,
          userPosition,
          market: market.publicKey,
          authority,
          user: user.publicKey,
        })
        .signers([user])
        .rpc()
    ).rejects.toThrowAnchorError(ErrorCode.UserAccountCannotBeMarketAccount);
  });

  it('fails to claim if the user provides a token account they do not own', async () => {
    expect.assertions(1);

    const otherAccount = Keypair.generate();
    const otherAccountIxs = await createInitAccountInstructions({
      account: otherAccount.publicKey,
      mint: mint.publicKey,
      user: feeWallet.publicKey,
      connection: provider.connection,
      payer: provider.wallet.publicKey,
    });

    await expect(
      program.methods
        .claim()
        .accounts({
          globalState,
          feeAccount,
          userTokenAccount: otherAccount.publicKey,
          yesTokenAccount,
          noTokenAccount,
          userPosition,
          market: market.publicKey,
          authority,
          user: user.publicKey,
        })
        .preInstructions([...otherAccountIxs])
        .signers([user, otherAccount])
        .rpc()
    ).rejects.toThrowAnchorError(ErrorCode.UserAccountIncorrectOwner);
  });

  it('fails to claim if the user position is incorrect', async () => {
    expect.assertions(1);

    const otherUser = Keypair.generate();
    const [otherUserPosition] = PublicKey.findProgramAddressSync(
      [
        Buffer.from('user'),
        otherUser.publicKey.toBuffer(),
        market.publicKey.toBuffer(),
      ],
      program.programId
    );
    const otherUserPositionIx = await program.methods
      .initializeUserPosition()
      .accounts({
        user: otherUser.publicKey,
        market: market.publicKey,
        userPosition: otherUserPosition,
      })
      .instruction();

    await expect(
      program.methods
        .claim()
        .accounts({
          globalState,
          feeAccount,
          userTokenAccount: userTokenAccount.publicKey,
          yesTokenAccount,
          noTokenAccount,
          userPosition: otherUserPosition,
          market: market.publicKey,
          authority,
          user: user.publicKey,
        })
        .preInstructions([otherUserPositionIx])
        .signers([user, otherUser])
        .rpc()
    ).rejects.toThrowAnchorError(LangErrorCode.ConstraintSeeds);
  });

  it('fails to claim if the yes token account provided is incorrect', async () => {
    expect.assertions(1);

    const otherAccount = Keypair.generate();
    const otherAccountIxs = await createInitAccountInstructions({
      account: otherAccount.publicKey,
      mint: mint.publicKey,
      user: Keypair.generate().publicKey,
      connection: provider.connection,
      payer: provider.wallet.publicKey,
    });

    await expect(
      program.methods
        .claim()
        .accounts({
          globalState,
          feeAccount,
          userTokenAccount: userTokenAccount.publicKey,
          yesTokenAccount: otherAccount.publicKey,
          noTokenAccount,
          userPosition,
          market: market.publicKey,
          authority,
          user: user.publicKey,
        })
        .preInstructions([...otherAccountIxs])
        .signers([user, otherAccount])
        .rpc()
    ).rejects.toThrowAnchorError(ErrorCode.IncorrectYesEscrow);
  });

  it('fails to claim if the no token account provided is incorrect', async () => {
    expect.assertions(1);

    const otherAccount = Keypair.generate();
    const otherAccountIxs = await createInitAccountInstructions({
      account: otherAccount.publicKey,
      mint: mint.publicKey,
      user: Keypair.generate().publicKey,
      connection: provider.connection,
      payer: provider.wallet.publicKey,
    });

    await expect(
      program.methods
        .claim()
        .accounts({
          globalState,
          feeAccount,
          userTokenAccount: userTokenAccount.publicKey,
          yesTokenAccount,
          noTokenAccount: otherAccount.publicKey,
          userPosition,
          market: market.publicKey,
          authority,
          user: user.publicKey,
        })
        .preInstructions([...otherAccountIxs])
        .signers([user, otherAccount])
        .rpc()
    ).rejects.toThrowAnchorError(ErrorCode.IncorrectNoEscrow);
  });

  it('fails to claim if the market has not finalized', async () => {
    expect.assertions(1);

    await expect(
      program.methods
        .claim()
        .accounts({
          globalState,
          feeAccount,
          userTokenAccount: userTokenAccount.publicKey,
          yesTokenAccount,
          noTokenAccount,
          userPosition,
          market: market.publicKey,
          authority,
          user: user.publicKey,
        })
        .signers([user])
        .rpc()
    ).rejects.toThrowProgramError(ErrorCode.NotFinalized);
  });
});
