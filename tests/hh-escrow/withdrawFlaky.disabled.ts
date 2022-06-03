// This file contains tests for the withdraw instruction that rely on block
// timing and are hence flaky.
import * as anchor from '@project-serum/anchor';
import { Program, LangErrorCode } from '@project-serum/anchor';
import { findProgramAddressSync } from '@project-serum/anchor/dist/cjs/utils/pubkey';
import {
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import type { HhEscrow } from '../../target/types/hh_escrow';
import { intoU64BN } from '../u64';
import {
  createInitAccountInstructions,
  createInitMintInstructions,
  delay,
} from '../utils';
import type { InitializeMarketParams } from './utils';

const MAX_WAIT_S = 8;

describe('hh-escrow withdraw tests', () => {
  const YES_AMOUNT = 1_000_000;
  const NO_AMOUNT = 2_000_000;

  // Configure the client to use the local cluster.
  const provider = anchor.Provider.env();
  anchor.setProvider(provider);
  const spl = anchor.Spl.token(provider);

  const program = anchor.workspace.HhEscrow as Program<HhEscrow>;

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
    yesTokenAccount: PublicKey,
    yesNonce: number,
    noTokenAccount: PublicKey,
    noNonce: number,
    userPosition: PublicKey;

  // Instructions.
  let initializeIx: TransactionInstruction;
  let userPositionIx: TransactionInstruction;
  let updateStateIx: TransactionInstruction;

  beforeAll(async () => {
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

    await provider.send(
      new Transaction().add(...mintIxs, ...userTokenAccountIxs),
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
    userPositionIx = await program.methods
      .initializeUserPosition()
      .accounts({
        user: user.publicKey,
        market: market.publicKey,
        userPosition,
      })
      .instruction();
    updateStateIx = await program.methods
      .updateState({ outcome: { Invalid: {} } })
      .accounts({
        market: market.publicKey,
        resolver: resolver.publicKey,
      })
      .instruction();
  });

  it('fails to withdraw if the user position is incorrect', async () => {
    expect.assertions(1);
    const otherUser = Keypair.generate();
    const [wrongUserPosition] = findProgramAddressSync(
      [
        Buffer.from('user'),
        otherUser.publicKey.toBuffer(),
        market.publicKey.toBuffer(),
      ],
      program.programId
    );

    userPositionIx = await program.methods
      .initializeUserPosition()
      .accounts({
        user: otherUser.publicKey,
        market: market.publicKey,
        userPosition: wrongUserPosition,
      })
      .instruction();

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
    initializeIx = await program.methods
      .initializeMarket(initializeParams)
      .accounts({
        market: market.publicKey,
        tokenMint: mint.publicKey,
        authority,
        yesTokenAccount,
        noTokenAccount,
      })
      .instruction();

    await provider.send(new Transaction().add(initializeIx), [market]);

    await expect(
      program.methods
        .withdraw()
        .accounts({
          user: user.publicKey,
          yesTokenAccount,
          noTokenAccount,
          userTokenAccount: userTokenAccount.publicKey,
          authority: authority,
          market: market.publicKey,
          userPosition: wrongUserPosition,
        })
        .preInstructions([userPositionIx, updateStateIx])
        .signers([user, otherUser, resolver])
        .rpc()
    ).rejects.toThrowAnchorError(LangErrorCode.ConstraintSeeds);
  });

  it('withdraws tokens for a user', async () => {
    expect.assertions(10);

    const epochInfo = await provider.connection.getEpochInfo();
    const time = await provider.connection.getBlockTime(
      epochInfo.absoluteSlot + 1
    );

    if (!time) throw Error('No block time found!');
    const initializeParams = {
      ...defaultMarketParams,
      closeTs: intoU64BN(time + 1),
      expiryTs: intoU64BN(time + 3600),
    };
    initializeIx = await program.methods
      .initializeMarket(initializeParams)
      .accounts({
        market: market.publicKey,
        tokenMint: mint.publicKey,
        authority,
        yesTokenAccount,
        noTokenAccount,
      })
      .instruction();
    await program.methods
      .deposit({
        yesAmount: intoU64BN(1),
        noAmount: intoU64BN(2),
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
      .preInstructions([initializeIx, userPositionIx])
      .signers([market, user])
      .rpc();

    let yesAcc = await provider.connection.getTokenAccountBalance(
      yesTokenAccount
    );
    let noAcc = await provider.connection.getTokenAccountBalance(
      noTokenAccount
    );
    let userAcc = await provider.connection.getTokenAccountBalance(
      userTokenAccount.publicKey
    );
    let userPositionAccount = await program.account.userPosition.fetch(
      userPosition
    );

    expect(yesAcc.value.amount).toBe('1');
    expect(noAcc.value.amount).toBe('2');
    expect(userAcc.value.amount).toBe('4999997');
    expect(userPositionAccount.yesAmount).toEqualBN(1);
    expect(userPositionAccount.noAmount).toEqualBN(2);

    // Wait for the time to pass the closeTs. If too much real time passes and
    // the time has not incremented on the validator, then  we error.
    let flag = false;
    for (let i = 0; i < MAX_WAIT_S; i++) {
      await delay(1000);
      const newEpochInfo = await provider.connection.getEpochInfo();
      const newTime = await provider.connection.getBlockTime(
        newEpochInfo.absoluteSlot + 1
      );
      if (newTime && newTime > time + 1) {
        flag = true;
        break;
      }
    }

    if (!flag) throw new Error('Test timed out waiting for time increment!');

    await program.methods
      .withdraw()
      .accounts({
        user: user.publicKey,
        yesTokenAccount,
        noTokenAccount,
        userTokenAccount: userTokenAccount.publicKey,
        authority: authority,
        market: market.publicKey,
        userPosition,
      })
      .preInstructions([updateStateIx])
      .signers([resolver, user])
      .rpc();

    yesAcc = await provider.connection.getTokenAccountBalance(yesTokenAccount);
    noAcc = await provider.connection.getTokenAccountBalance(noTokenAccount);
    userAcc = await provider.connection.getTokenAccountBalance(
      userTokenAccount.publicKey
    );
    userPositionAccount = await program.account.userPosition.fetch(
      userPosition
    );

    expect(yesAcc.value.amount).toBe('0');
    expect(noAcc.value.amount).toBe('0');
    expect(userAcc.value.amount).toBe('5000000');
    expect(userPositionAccount.yesAmount).toEqualBN(0);
    expect(userPositionAccount.noAmount).toEqualBN(0);
  });
});
