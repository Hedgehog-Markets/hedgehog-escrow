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
// 
// These tests are also flaky, as they rely on clock progression.
import * as anchor from '@project-serum/anchor';
import { Program } from '@project-serum/anchor';
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import {
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddress,
} from '@solana/spl-token';
import type { HhEscrow } from '../../target/types/hh_escrow';
import { intoU64BN } from '../u64';
import {
  createInitAccountInstructions,
  createInitMintInstructions,
  delay,
} from '../utils';
import { ErrorCode, InitializeMarketParams } from './utils';

describe('hh-escrow claim clock-dependent tests', () => {
  const YES_AMOUNT = 1_000_000;
  const NO_AMOUNT = 2_000_000;

  // Configure the client to use the local cluster.
  const provider = anchor.Provider.env();
  anchor.setProvider(provider);
  const spl = anchor.Spl.token(provider);

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
    yesNonce: number,
    noTokenAccount: PublicKey,
    noNonce: number,
    userPosition: PublicKey;

  // Instructions.
  let userPositionIx: TransactionInstruction;
  let updateStateIx: TransactionInstruction;

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
  });

  beforeEach(async () => {
    market = Keypair.generate();
    [authority] = PublicKey.findProgramAddressSync(
      [Buffer.from('authority'), market.publicKey.toBuffer()],
      program.programId
    );
    [yesTokenAccount, yesNonce] = PublicKey.findProgramAddressSync(
      [Buffer.from('yes'), market.publicKey.toBuffer()],
      program.programId
    );
    [noTokenAccount, noNonce] = PublicKey.findProgramAddressSync(
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

    const { value } = await provider.connection.getTokenAccountBalance(
      userTokenAccount.publicKey
    );

    // Top off the user's token account before each test.
    const topOff = 5_000_000n - BigInt(value.amount);
    if (topOff > 0n) {
      await spl.methods
        .mintTo(intoU64BN(topOff))
        .accounts({
          mint: mint.publicKey,
          authority: provider.wallet.publicKey,
          to: userTokenAccount.publicKey,
        })
        .rpc();
    }

    userPositionIx = await program.methods
      .initializeUserPosition()
      .accounts({
        user: user.publicKey,
        market: market.publicKey,
        userPosition,
      })
      .instruction();
    updateStateIx = await program.methods
      .updateState({ outcome: { No: {} } })
      .accounts({
        market: market.publicKey,
        resolver: resolver.publicKey,
      })
      .instruction();
  });

  it('fails to claim if the market has finalized to invalid', async () => {
    const epochInfo = await provider.connection.getEpochInfo();
    const time = await provider.connection.getBlockTime(
      epochInfo.absoluteSlot + 1
    );

    if (!time) throw Error('No block time found!');
    const initializeParams = {
      ...defaultMarketParams,
      closeTs: intoU64BN(time),
      expiryTs: intoU64BN(time + 3600),
    };
    await program.methods
      .initializeMarket(initializeParams)
      .accounts({
        market: market.publicKey,
        tokenMint: mint.publicKey,
        authority,
        yesTokenAccount,
        noTokenAccount,
      })
      .postInstructions([userPositionIx])
      .signers([market, user])
      .rpc();

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
    ).rejects.toThrowProgramError(ErrorCode.CannotClaim);
  });

  it('claims correctly', async () => {
    expect.assertions(6);

    // Prep a deposit from another owner.
    const fillNo = NO_AMOUNT - 117;
    const otherUserTokenAccount = Keypair.generate();
    const otherUser = Keypair.generate();
    const [otherUserPosition] = PublicKey.findProgramAddressSync(
      [
        Buffer.from('user'),
        otherUser.publicKey.toBuffer(),
        market.publicKey.toBuffer(),
      ],
      program.programId
    );
    const userTokenAccountIxs = await createInitAccountInstructions({
      account: otherUserTokenAccount.publicKey,
      mint: mint.publicKey,
      user: otherUser.publicKey,
      connection: provider.connection,
      payer: provider.wallet.publicKey,
    });
    await spl.methods
      .mintTo(intoU64BN(fillNo))
      .accounts({
        mint: mint.publicKey,
        authority: provider.wallet.publicKey,
        to: otherUserTokenAccount.publicKey,
      })
      .signers([otherUserTokenAccount])
      .preInstructions([...userTokenAccountIxs])
      .rpc();

    const depositUserIx = await program.methods
      .deposit({
        yesAmount: intoU64BN(YES_AMOUNT),
        noAmount: intoU64BN(117),
        allowPartial: true,
      })
      .accounts({
        user: user.publicKey,
        market: market.publicKey,
        yesTokenAccount,
        noTokenAccount,
        userTokenAccount: userTokenAccount.publicKey,
        userPosition,
      })
      .instruction();

    const otherUserPositionIx = await program.methods
      .initializeUserPosition()
      .accounts({
        user: otherUser.publicKey,
        market: market.publicKey,
        userPosition: otherUserPosition,
      })
      .instruction();

    const epochInfo = await provider.connection.getEpochInfo();
    const time = await provider.connection.getBlockTime(
      epochInfo.absoluteSlot + 1
    );

    if (!time) throw Error('No block time found!');
    const initializeParams = {
      ...defaultMarketParams,
      closeTs: intoU64BN(time + 2),
      expiryTs: intoU64BN(time + 2),
      resolutionDelay: 0,
    };
    await program.methods
      .initializeMarket(initializeParams)
      .accounts({
        market: market.publicKey,
        tokenMint: mint.publicKey,
        authority,
        yesTokenAccount,
        noTokenAccount,
      })
      .postInstructions([userPositionIx, otherUserPositionIx])
      .signers([market, user, otherUser])
      .rpc();

    await program.methods
      .deposit({
        yesAmount: intoU64BN(0),
        noAmount: intoU64BN(fillNo),
        allowPartial: true,
      })
      .accounts({
        user: otherUser.publicKey,
        market: market.publicKey,
        yesTokenAccount,
        noTokenAccount,
        userTokenAccount: otherUserTokenAccount.publicKey,
        userPosition: otherUserPosition,
      })
      .signers([otherUser, user])
      .preInstructions([depositUserIx])
      .rpc();

    let pastExpiry = false;
    for (let i = 0; i < 8; i++) {
      await delay(1000);
      const epochInfo = await provider.connection.getEpochInfo();
      const time = await provider.connection.getBlockTime(
        epochInfo.absoluteSlot + 1
      );
      if (!time) {
        continue;
      }
      // .lten() doesn't seem to work.
      if (initializeParams.expiryTs.toNumber() < time) {
        pastExpiry = true;
        break;
      }
    }

    if (!pastExpiry) {
      throw new Error('Timed out waiting for clock progression!');
    }

    await program.methods
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
      .preInstructions([updateStateIx])
      .signers([user, resolver])
      .rpc();

    const userPositionAccount = await program.account.userPosition.fetch(
      userPosition
    );
    const userAcc = await provider.connection.getTokenAccountBalance(
      userTokenAccount.publicKey
    );
    const feeAcc = await provider.connection.getTokenAccountBalance(feeAccount);
    const yesAcc = await provider.connection.getTokenAccountBalance(
      yesTokenAccount
    );
    const noAcc = await provider.connection.getTokenAccountBalance(
      noTokenAccount
    );

    expect(userPositionAccount.yesAmount).toEqualBN(0);
    expect(userPositionAccount.noAmount).toEqualBN(0);
    expect(yesAcc.value.amount).toBe('999942');
    expect(noAcc.value.amount).toBe(fillNo.toString());
    expect(feeAcc.value.amount).toBe('1');
    expect(userAcc.value.amount).toBe('4000057');
  });
});
