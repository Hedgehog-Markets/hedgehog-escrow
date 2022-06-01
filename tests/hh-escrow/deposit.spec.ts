import * as anchor from '@project-serum/anchor';
import { Program, LangErrorCode } from '@project-serum/anchor';
import { Keypair, PublicKey, Transaction } from '@solana/web3.js';
import type { HhEscrow } from '../../target/types/hh_escrow';
import { intoU64BN } from '../u64';
import {
  createInitAccountInstructions,
  createInitMintInstructions,
} from '../utils';
import { DepositParams, ErrorCode, InitializeMarketParams } from './utils';

// NOTE: Tests in this block have a dependency order.
describe('hh-escrow deposit tests', () => {
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
  const initializeMarketParams: InitializeMarketParams = {
    closeTs: intoU64BN(closeTs),
    expiryTs: intoU64BN(expiryTs),
    resolutionDelay: 3600,
    yesAmount: intoU64BN(YES_AMOUNT),
    noAmount: intoU64BN(NO_AMOUNT),
    resolver: resolver.publicKey,
    uri: '0'.repeat(256),
  };
  const depositParams: DepositParams = {
    yesAmount: intoU64BN(YES_AMOUNT / 2),
    noAmount: intoU64BN(NO_AMOUNT / 2),
    allowPartial: false,
  };

  // Accounts.
  const mint = Keypair.generate();
  const market = Keypair.generate();
  const user = Keypair.generate();
  const userTokenAccount = Keypair.generate();
  const [authority] = PublicKey.findProgramAddressSync(
    [Buffer.from('authority'), market.publicKey.toBuffer()],
    program.programId
  );
  const [yesTokenAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from('yes'), market.publicKey.toBuffer()],
    program.programId
  );
  const [noTokenAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from('no'), market.publicKey.toBuffer()],
    program.programId
  );
  const [userPosition] = PublicKey.findProgramAddressSync(
    [
      Buffer.from('user'),
      user.publicKey.toBuffer(),
      market.publicKey.toBuffer(),
    ],
    program.programId
  );

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

    const ix = await program.methods
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
      .initializeUserPosition()
      .accounts({
        user: user.publicKey,
        payer: provider.wallet.publicKey,
        market: market.publicKey,
        userPosition,
      })
      .signers([market, user])
      .preInstructions([ix])
      .rpc();
  });

  beforeEach(async () => {
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
  });

  it('fails if the yes token account does not match the market account', async () => {
    expect.assertions(1);

    const otherTokenAccount = Keypair.generate();

    // Create another yes token account.
    const otherTokenAccountIxs = await createInitAccountInstructions({
      account: otherTokenAccount.publicKey,
      mint: mint.publicKey,
      user: provider.wallet.publicKey,
      connection: provider.connection,
      payer: provider.wallet.publicKey,
    });
    await provider.send(new Transaction().add(...otherTokenAccountIxs), [
      otherTokenAccount,
    ]);

    await expect(
      program.methods
        .deposit(depositParams)
        .accounts({
          user: user.publicKey,
          market: market.publicKey,
          yesTokenAccount: otherTokenAccount.publicKey,
          noTokenAccount,
          userTokenAccount: userTokenAccount.publicKey,
          userPosition,
        })
        .signers([user])
        .rpc()
    ).rejects.toThrowAnchorError(ErrorCode.IncorrectYesEscrow);
  });

  it('fails if the no token account does not match the market account', async () => {
    expect.assertions(1);

    const otherTokenAccount = Keypair.generate();

    // Create another yes token account.
    const otherTokenAccountIxs = await createInitAccountInstructions({
      account: otherTokenAccount.publicKey,
      mint: mint.publicKey,
      user: provider.wallet.publicKey,
      connection: provider.connection,
      payer: provider.wallet.publicKey,
    });
    await provider.send(new Transaction().add(...otherTokenAccountIxs), [
      otherTokenAccount,
    ]);

    await expect(
      program.methods
        .deposit(depositParams)
        .accounts({
          user: user.publicKey,
          market: market.publicKey,
          yesTokenAccount,
          noTokenAccount: otherTokenAccount.publicKey,
          userTokenAccount: userTokenAccount.publicKey,
          userPosition,
        })
        .signers([user])
        .rpc()
    ).rejects.toThrowAnchorError(ErrorCode.IncorrectNoEscrow);
  });

  it('fails if the user position account is incorrect', async () => {
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
    // Initialize a separate userPosition account.
    await program.methods
      .initializeUserPosition()
      .accounts({
        user: otherUser.publicKey,
        payer: provider.wallet.publicKey,
        market: market.publicKey,
        userPosition: otherUserPosition,
      })
      .signers([otherUser])
      .rpc();

    await expect(
      program.methods
        .deposit(depositParams)
        .accounts({
          user: user.publicKey,
          market: market.publicKey,
          yesTokenAccount,
          noTokenAccount,
          userTokenAccount: userTokenAccount.publicKey,
          userPosition: otherUserPosition,
        })
        .signers([user])
        .rpc()
    ).rejects.toThrowAnchorError(LangErrorCode.ConstraintSeeds);
  });

  it('fails if the yes amount to deposit exceeds the market amount, and allow_partial is false', async () => {
    expect.assertions(1);

    const newDepositParams = {
      ...depositParams,
      yesAmount: intoU64BN(YES_AMOUNT + 1),
    };

    await expect(
      program.methods
        .deposit(newDepositParams)
        .accounts({
          user: user.publicKey,
          market: market.publicKey,
          yesTokenAccount,
          noTokenAccount,
          userTokenAccount: userTokenAccount.publicKey,
          userPosition,
        })
        .signers([user])
        .rpc()
    ).rejects.toThrowProgramError(ErrorCode.OverAllowedAmount);
  });

  it('fails if the no amount to deposit exceeds the market amount, and allow_partial is false', async () => {
    expect.assertions(1);

    const newDepositParams = {
      ...depositParams,
      noAmount: intoU64BN(NO_AMOUNT + 1),
    };

    await expect(
      program.methods
        .deposit(newDepositParams)
        .accounts({
          user: user.publicKey,
          market: market.publicKey,
          yesTokenAccount,
          noTokenAccount,
          userTokenAccount: userTokenAccount.publicKey,
          userPosition,
        })
        .signers([user])
        .rpc()
    ).rejects.toThrowProgramError(ErrorCode.OverAllowedAmount);
  });

  it('successfully deposits', async () => {
    expect.assertions(4);

    await program.methods
      .deposit(depositParams)
      .accounts({
        user: user.publicKey,
        market: market.publicKey,
        yesTokenAccount,
        noTokenAccount,
        userTokenAccount: userTokenAccount.publicKey,
        userPosition,
      })
      .signers([user])
      .rpc();

    const userPositionAccount = await program.account.userPosition.fetch(
      userPosition
    );
    const marketAccount = await program.account.market.fetch(market.publicKey);

    expect(userPositionAccount.yesAmount).toEqualBN(YES_AMOUNT / 2);
    expect(userPositionAccount.noAmount).toEqualBN(NO_AMOUNT / 2);
    expect(marketAccount.yesFilled).toEqualBN(YES_AMOUNT / 2);
    expect(marketAccount.noFilled).toEqualBN(NO_AMOUNT / 2);
  });

  it('successfully fills if the amount to deposit exceeds the market amount, and allow_partial is true', async () => {
    expect.assertions(4);

    const newDepositParams = {
      yesAmount: intoU64BN(5_000_000),
      noAmount: intoU64BN(5_000_000),
      allowPartial: true,
    };

    await program.methods
      .deposit(newDepositParams)
      .accounts({
        user: user.publicKey,
        market: market.publicKey,
        yesTokenAccount,
        noTokenAccount,
        userTokenAccount: userTokenAccount.publicKey,
        userPosition,
      })
      .signers([user])
      .rpc();

    const userPositionAccount = await program.account.userPosition.fetch(
      userPosition
    );
    const marketAccount = await program.account.market.fetch(market.publicKey);

    expect(userPositionAccount.yesAmount).toEqualBN(YES_AMOUNT);
    expect(userPositionAccount.noAmount).toEqualBN(NO_AMOUNT);
    expect(marketAccount.yesFilled).toEqualBN(YES_AMOUNT);
    expect(marketAccount.noFilled).toEqualBN(NO_AMOUNT);
  });
});
