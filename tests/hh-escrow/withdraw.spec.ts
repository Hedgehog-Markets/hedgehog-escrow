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
} from '../utils';
import { ErrorCode, InitializeMarketParams } from './utils';

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
  });

  it('fails to withdraw if the outcome is not invalid', async () => {
    expect.assertions(1);

    await expect(
      program.methods
        .withdraw()
        .accounts({
          user: user.publicKey,
          yesTokenAccount,
          noTokenAccount,
          userTokenAccount: userTokenAccount.publicKey,
          authority,
          market: market.publicKey,
          userPosition,
        })
        .preInstructions([initializeIx, userPositionIx])
        .signers([market, user])
        .rpc()
    ).rejects.toThrowAnchorError(ErrorCode.MarketNotInvalid);
  });

  it('fails to withdraw if the outcome is invalid but not finalized', async () => {
    expect.assertions(1);
    await program.methods
      .updateState({ outcome: { Invalid: {} } })
      .accounts({
        market: market.publicKey,
        resolver: resolver.publicKey,
      })
      .preInstructions([initializeIx, userPositionIx])
      .signers([market, user, resolver])
      .rpc();

    await expect(
      program.methods
        .withdraw()
        .accounts({
          user: user.publicKey,
          yesTokenAccount,
          noTokenAccount,
          userTokenAccount: userTokenAccount.publicKey,
          authority,
          market: market.publicKey,
          userPosition,
        })
        .signers([user])
        .rpc()
    ).rejects.toThrowProgramError(ErrorCode.NotFinalized);
  });

  it('fails to withdraw if the yes token account is incorrect', async () => {
    expect.assertions(1);
    const otherAccount = Keypair.generate();

    await expect(
      program.methods
        .withdraw()
        .accounts({
          user: user.publicKey,
          yesTokenAccount: otherAccount.publicKey,
          noTokenAccount,
          userTokenAccount: userTokenAccount.publicKey,
          authority,
          market: market.publicKey,
          userPosition,
        })
        .preInstructions([initializeIx, userPositionIx])
        .signers([market, user])
        .rpc()
    ).rejects.toThrowAnchorError(ErrorCode.IncorrectYesEscrow);
  });

  it('fails to withdraw if the no token account is incorrect', async () => {
    expect.assertions(1);
    const otherAccount = Keypair.generate();

    await expect(
      program.methods
        .withdraw()
        .accounts({
          user: user.publicKey,
          yesTokenAccount,
          noTokenAccount: otherAccount.publicKey,
          userTokenAccount: userTokenAccount.publicKey,
          authority,
          market: market.publicKey,
          userPosition,
        })
        .preInstructions([initializeIx, userPositionIx])
        .signers([market, user])
        .rpc()
    ).rejects.toThrowAnchorError(ErrorCode.IncorrectNoEscrow);
  });

  it('fails to withdraw if the authority is incorrect', async () => {
    expect.assertions(1);
    const [wrongAuthority] = findProgramAddressSync(
      [Buffer.from('authority')],
      program.programId
    );

    await expect(
      program.methods
        .withdraw()
        .accounts({
          user: user.publicKey,
          yesTokenAccount,
          noTokenAccount,
          userTokenAccount: userTokenAccount.publicKey,
          authority: wrongAuthority,
          market: market.publicKey,
          userPosition,
        })
        .preInstructions([initializeIx, userPositionIx])
        .signers([market, user])
        .rpc()
    ).rejects.toThrowAnchorError(LangErrorCode.ConstraintSeeds);
  });

  it('fails to withdraw if the user token account provided is the yes token account', async () => {
    expect.assertions(1);

    await expect(
      program.methods
        .withdraw()
        .accounts({
          user: user.publicKey,
          yesTokenAccount,
          noTokenAccount,
          userTokenAccount: yesTokenAccount,
          authority,
          market: market.publicKey,
          userPosition,
        })
        .preInstructions([initializeIx, userPositionIx])
        .signers([market, user])
        .rpc()
    ).rejects.toThrowAnchorError(ErrorCode.UserAccountCannotBeMarketAccount);
  });

  it('fails to withdraw if the user token account provided is the no token account', async () => {
    expect.assertions(1);

    await expect(
      program.methods
        .withdraw()
        .accounts({
          user: user.publicKey,
          yesTokenAccount,
          noTokenAccount,
          userTokenAccount: noTokenAccount,
          authority,
          market: market.publicKey,
          userPosition,
        })
        .preInstructions([initializeIx, userPositionIx])
        .signers([market, user])
        .rpc()
    ).rejects.toThrowAnchorError(ErrorCode.UserAccountCannotBeMarketAccount);
  });

  it('fails to withdraw if the user token account is not owned by the user', async () => {
    expect.assertions(1);

    const newTokenAccount = Keypair.generate();
    const newUser = Keypair.generate().publicKey;
    const newTokenAccountIxs = await createInitAccountInstructions({
      account: newTokenAccount.publicKey,
      mint: mint.publicKey,
      user: newUser,
      connection: provider.connection,
      payer: provider.wallet.publicKey,
    });

    await expect(
      program.methods
        .withdraw()
        .accounts({
          user: user.publicKey,
          yesTokenAccount,
          noTokenAccount,
          userTokenAccount: newTokenAccount.publicKey,
          authority,
          market: market.publicKey,
          userPosition,
        })
        .preInstructions([initializeIx, userPositionIx, ...newTokenAccountIxs])
        .signers([market, user, newTokenAccount])
        .rpc()
    ).rejects.toThrowAnchorError(ErrorCode.UserAccountIncorrectOwner);
  });

  it('withdraws tokens for a user', async () => {
    expect.assertions(12);

    const initializeMarketParams = {
      ...defaultMarketParams,
      // Instant finalize.
      resolutionDelay: 0,
    };
    initializeIx = await program.methods
      .initializeMarket(initializeMarketParams)
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

    await program.methods
      .updateState({ outcome: { Invalid: {} } })
      .accounts({
        market: market.publicKey,
        resolver: resolver.publicKey,
      })
      .signers([resolver])
      .rpc();

    let marketAccount = await program.account.market.fetch(market.publicKey);
    expect(marketAccount.finalized).toBeFalsy();

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
      .signers([user])
      .rpc();

    marketAccount = await program.account.market.fetch(market.publicKey);

    expect(yesAcc.value.amount).toBe('1');
    expect(noAcc.value.amount).toBe('2');
    expect(userAcc.value.amount).toBe('4999997');
    expect(userPositionAccount.yesAmount).toEqualBN(1);
    expect(userPositionAccount.noAmount).toEqualBN(2);
    expect(marketAccount.finalized).toBeTruthy();
  });
});
