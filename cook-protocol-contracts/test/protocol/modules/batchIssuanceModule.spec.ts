import "module-alias/register";
import { BigNumber, BigNumberish } from "@ethersproject/bignumber";
import { ContractTransaction } from "ethers";

import { Address, BatchIssuanceSetting, StreamingFeeState } from "@utils/types";
import { Account } from "@utils/test/types";
import { ONE, TWO, THREE, ZERO, ADDRESS_ZERO, MAX_UINT_256 } from "@utils/constants";
import { BatchIssuanceHookMock, BatchIssuanceModule, CKToken, UniswapV2IndexExchangeAdapter } from "@utils/contracts";
import DeployHelper from "@utils/deploys";
import { bitcoin, ether, preciseMul, usdc } from "@utils/index";
import {
  getAccounts,
  getRandomAddress,
  cacheBeforeEach,
  getRandomAccount,
  getWaffleExpect,
  getSystemFixture,
  getUniswapFixture
} from "@utils/test/index";
import { SystemFixture, UniswapFixture } from "@utils/fixtures";

const expect = getWaffleExpect();

describe("BatchIssuanceModule", () => {
  let owner: Account;
  let feeRecipient: Account;
  let recipient: Account;
  let deployer: DeployHelper;

  let setup: SystemFixture;
  let uniswapSetup: UniswapFixture;
  let sushiswapSetup: UniswapFixture;

  let sushiswapExchangeAdapter: UniswapV2IndexExchangeAdapter;
  let sushiswapAdapterName: string;
  let uniswapExchangeAdapter: UniswapV2IndexExchangeAdapter;
  let uniswapAdapterName: string;

  let batchIssuanceModule: BatchIssuanceModule;
  let batchIssuanceSetting: BatchIssuanceSetting;
  let batchIssuanceHook: Address;

  let ckComponents: Address[];
  let ckUnits: BigNumber[];
  let ckToken: CKToken;
  let roundInputCap: BigNumber;

  cacheBeforeEach(async () => {
    [
      owner,
      feeRecipient,
      recipient,
    ] = await getAccounts();

    deployer = new DeployHelper(owner.wallet);
    setup = getSystemFixture(owner.address);
    uniswapSetup = getUniswapFixture(owner.address);
    sushiswapSetup = getUniswapFixture(owner.address);
    await setup.initialize();

    await uniswapSetup.initialize(owner, setup.weth.address, setup.wbtc.address, setup.dai.address);
    await sushiswapSetup.initialize(owner, setup.weth.address, setup.wbtc.address, setup.dai.address);

    sushiswapExchangeAdapter = await deployer.modules.deployUniswapV2IndexExchangeAdapter(sushiswapSetup.router.address);
    uniswapExchangeAdapter = await deployer.modules.deployUniswapV2IndexExchangeAdapter(uniswapSetup.router.address);

    sushiswapAdapterName = "SUSHISWAP";
    uniswapAdapterName = "UNISWAP";

    batchIssuanceModule = await deployer.modules.deployBatchIssuanceModule(setup.controller.address, setup.weth.address);
    await setup.controller.addModule(batchIssuanceModule.address);

    await setup.integrationRegistry.batchAddIntegration(
      [batchIssuanceModule.address, batchIssuanceModule.address],
      [sushiswapAdapterName, uniswapAdapterName],
      [sushiswapExchangeAdapter.address, uniswapExchangeAdapter.address]
    );

    await setup.weth.connect(owner.wallet).approve(uniswapSetup.router.address, ether(2000));
    await setup.dai.connect(owner.wallet).approve(uniswapSetup.router.address, ether(460000));
    await uniswapSetup.router.connect(owner.wallet).addLiquidity(
      setup.weth.address,
      setup.dai.address,
      ether(2000),
      ether(460000),
      ether(1485),
      ether(173000),
      owner.address,
      MAX_UINT_256
    );

    await setup.weth.connect(owner.wallet).approve(sushiswapSetup.router.address, ether(1000));
    await setup.wbtc.connect(owner.wallet).approve(sushiswapSetup.router.address, ether(26));
    await sushiswapSetup.router.addLiquidity(
      setup.weth.address,
      setup.wbtc.address,
      ether(1000),
      bitcoin(25.5555),
      ether(999),
      ether(25.3),
      owner.address,
      MAX_UINT_256
    );

    ckComponents = [setup.dai.address, setup.wbtc.address];
    ckUnits = [ether(86.9565217), bitcoin(.01111111)];
    ckToken = await setup.createCKToken(
      ckComponents,
      ckUnits,               // $100 of each
      [setup.issuanceModule.address, setup.streamingFeeModule.address, batchIssuanceModule.address],
    );

    const feeSettings = {
      feeRecipient: owner.address,
      maxStreamingFeePercentage: ether(.1),
      streamingFeePercentage: ether(.01),
      lastStreamingFeeTimestamp: ZERO,
    } as StreamingFeeState;

    await setup.streamingFeeModule.initialize(ckToken.address, feeSettings);
    await setup.issuanceModule.initialize(ckToken.address, ADDRESS_ZERO);

    // Set round cap limit
    roundInputCap = ether(10);

    batchIssuanceSetting = {
      feeRecipient: feeRecipient.address,
      managerFees: [ether(0.04), ether(0.05)],
      maxManagerFee: ether(0.1),
      minCKTokenSupply: ether(5),
    } as BatchIssuanceSetting;

    batchIssuanceHook = ADDRESS_ZERO;

    await batchIssuanceModule.connect(owner.wallet).initialize(
      ckToken.address,
      setup.issuanceModule.address,
      batchIssuanceHook,
      batchIssuanceSetting,
      roundInputCap
    );

    // min some ckTokens
    // Approve tokens to the issuance mdoule
    await setup.dai.approve(setup.issuanceModule.address, ether(10000));
    await setup.wbtc.approve(setup.issuanceModule.address, bitcoin(10));

    return setup.issuanceModule.connect(owner.wallet).issue(
      ckToken.address,
      ether(10),
      owner.address
    );
  });

  describe("#constructor", async () => {
    let subjectController: Address;
    let subjectWETH: Address;

    beforeEach(async () => {
      subjectController = setup.controller.address;
      subjectWETH = setup.weth.address;
    });

    async function subject(): Promise<BatchIssuanceModule> {
      return deployer.modules.deployBatchIssuanceModule(subjectController, subjectWETH);
    }

    it("should set the correct controller", async () => {
      const batchIssuanceModule = await subject();

      const controller = await batchIssuanceModule.controller();
      expect(controller).to.eq(subjectController);
    });

    it("should set the correct weth contract", async () => {
      const batchIssuanceModule = await subject();

      const weth = await batchIssuanceModule.weth();
      expect(weth).to.eq(subjectWETH);
    });
  });

  describe("#initialize", async () => {
    let ckToken: CKToken;
    let batchIssuanceHook: Address;
    let basicIssuanceModule: Address;
    let roundInputCap: BigNumber;

    let managerFeeRecipient: Address;
    let managerFees: [BigNumberish, BigNumberish];
    let maxManagerFee: BigNumber;
    let minCKTokenSupply: BigNumber;

    let subjectBatchIssuanceSetting: BatchIssuanceSetting;
    let subjectCKToken: Address;
    let subjectCaller: Account;

    cacheBeforeEach(async () => {
      ckToken = await setup.createCKToken(
        [setup.weth.address],
        [ether(1)],
        [batchIssuanceModule.address]
      );

      batchIssuanceHook = await getRandomAddress();
      basicIssuanceModule = await getRandomAddress();

      managerFeeRecipient = feeRecipient.address;
      // Set manager issue fee to 0.1% and redeem to 0.2%
      managerFees = [ether(0.001), ether(0.002)];
      // Set max managerFee to 2%
      maxManagerFee = ether(0.02);
      // Set min CKToken supply to 100 units
      minCKTokenSupply = ether(100);
      // Set round cap limit
      roundInputCap = ether(50);
    });

    beforeEach(async () => {
      subjectCKToken = ckToken.address;
      subjectBatchIssuanceSetting = {
        feeRecipient: managerFeeRecipient,
        managerFees,
        maxManagerFee,
        minCKTokenSupply,
      } as BatchIssuanceSetting;
      subjectCaller = owner;
    });

    async function subject(): Promise<any> {
      return batchIssuanceModule.connect(subjectCaller.wallet).initialize(
        subjectCKToken,
        basicIssuanceModule,
        batchIssuanceHook,
        subjectBatchIssuanceSetting,
        roundInputCap
      );
    }

    it("should set the correct batch issuance settings", async () => {
      await subject();

      const _batchIssuanceSetting: any = await batchIssuanceModule.batchIssuanceSetting();
      const _basicIssuanceModule: Address = await batchIssuanceModule.basicIssuanceModule();
      const _batchIssuanceHook: Address = await batchIssuanceModule.batchIssuanceHook();
      const _roundInputCap: BigNumber = await batchIssuanceModule.roundInputCap();
      const _managerIssueFee = await batchIssuanceModule.getManagerFee(ZERO);
      const _managerRedeemFee = await batchIssuanceModule.getManagerFee(ONE);

      expect(_basicIssuanceModule).to.eq(basicIssuanceModule);
      expect(_batchIssuanceHook).to.eq(batchIssuanceHook);
      expect(_roundInputCap).to.eq(roundInputCap);
      expect(_managerIssueFee).to.eq(managerFees[0]);
      expect(_managerRedeemFee).to.eq(managerFees[1]);
      expect(_batchIssuanceSetting.feeRecipient).to.eq(managerFeeRecipient);
      expect(_batchIssuanceSetting.maxManagerFee).to.eq(maxManagerFee);
      expect(_batchIssuanceSetting.minCKTokenSupply).to.eq(minCKTokenSupply);
    });

    it("should enable the Module on the CKToken", async () => {
      await subject();

      const isModuleEnabled = await ckToken.isInitializedModule(batchIssuanceModule.address);
      expect(isModuleEnabled).to.eq(true);
    });

    describe("when the caller is not the CKToken manager", async () => {
      beforeEach(async () => {
        subjectCaller = await getRandomAccount();
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Must be the CKToken manager");
      });
    });

    describe("when CKToken is not in pending state", async () => {
      beforeEach(async () => {
        const newModule = await getRandomAddress();
        await setup.controller.addModule(newModule);

        const batchIssuanceModuleNotPendingCKToken = await setup.createCKToken(
          [setup.weth.address],
          [ether(1)],
          [newModule]
        );

        subjectCKToken = batchIssuanceModuleNotPendingCKToken.address;
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Must be pending initialization");
      });
    });

    describe("when the CKToken is not enabled on the controller", async () => {
      beforeEach(async () => {
        const nonEnabledCKToken = await setup.createNonControllerEnabledCKToken(
          [setup.weth.address],
          [ether(1)],
          [batchIssuanceModule.address]
        );

        subjectCKToken = nonEnabledCKToken.address;
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Must be controller-enabled CKToken");
      });
    });

    describe("when manager issue fee is greater than max", async () => {
      beforeEach(async () => {
        // Set to 100%
        subjectBatchIssuanceSetting.managerFees = [ether(1), ether(0.002)];
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Manager issue fee must be less than max");
      });
    });

    describe("when manager redeem fee is greater than max", async () => {
      beforeEach(async () => {
        // Set to 100%
        subjectBatchIssuanceSetting.managerFees = [ether(0.001), ether(1)];
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Manager redeem fee must be less than max");
      });
    });

    describe("when max manager fee is greater than 100%", async () => {
      beforeEach(async () => {
        // Set to 200%
        subjectBatchIssuanceSetting.maxManagerFee = ether(2);
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Max manager fee must be less than 100%");
      });
    });

    describe("when feeRecipient is zero address", async () => {
      beforeEach(async () => {
        subjectBatchIssuanceSetting.feeRecipient = ADDRESS_ZERO;
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Fee Recipient must be non-zero address.");
      });
    });

    describe("when min CKToken supply is 0", async () => {
      beforeEach(async () => {
        subjectBatchIssuanceSetting.minCKTokenSupply = ZERO;
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Min CKToken supply must be greater than 0");
      });
    });
  });

  describe("#deposit", async() => {
    describe("when deposit with WETH", async () => {
      beforeEach(async () => {
        await setup.weth.approve(batchIssuanceModule.address, MAX_UINT_256);
      });

      it("should deposit 1 weth", async() => {
        const depositAmount = ether(1);

        const inputBalanceBefore = await setup.weth.balanceOf(owner.address);
        await batchIssuanceModule.deposit(depositAmount);
        const inputBalanceAfter = await setup.weth.balanceOf(owner.address);

        const userInputBalance = await batchIssuanceModule.inputBalanceOf(owner.address);
        const userRoundInputBalance = await batchIssuanceModule.roundInputBalanceOf(0, owner.address);
        const totalInputBalance = await setup.weth.balanceOf(batchIssuanceModule.address);
        const roundsCount = await batchIssuanceModule.getRoundsCount();
        const userRoundsCount = await batchIssuanceModule.getUserRoundsCount(owner.address);

        expect(inputBalanceAfter).to.eq(inputBalanceBefore.sub(depositAmount));
        expect(userInputBalance).to.eq(depositAmount);
        expect(userRoundInputBalance).to.eq(depositAmount);
        expect(totalInputBalance).to.eq(depositAmount);
        expect(roundsCount).to.eq(1);
        expect(userRoundsCount).to.eq(1);
      });

      it("should deposit multiple times into a single round", async() => {
        const deposit1Amount = ether(1);
        const deposit2Amount = ether(3);
        const totalDeposit = deposit1Amount.add(deposit2Amount);

        const inputBalanceBefore = await setup.weth.balanceOf(owner.address);
        await batchIssuanceModule.deposit(deposit1Amount);
        await batchIssuanceModule.deposit(deposit2Amount);
        const inputBalanceAfter = await setup.weth.balanceOf(owner.address);

        const userInputBalance = await batchIssuanceModule.inputBalanceOf(owner.address);
        const userRoundInputBalance = await batchIssuanceModule.roundInputBalanceOf(0, owner.address);
        const totalInputBalance = await setup.weth.balanceOf(batchIssuanceModule.address);
        const roundsCount = await batchIssuanceModule.getRoundsCount();
        const userRoundsCount = await batchIssuanceModule.getUserRoundsCount(owner.address);

        expect(inputBalanceAfter).to.eq(inputBalanceBefore.sub(totalDeposit));
        expect(userInputBalance).to.eq(totalDeposit);
        expect(userRoundInputBalance).to.eq(totalDeposit);
        expect(totalInputBalance).to.eq(totalDeposit);
        expect(roundsCount).to.eq(1);
        expect(userRoundsCount).to.eq(1);
      });

      it("should deposit multiple times into a single round from different rounds", async() => {
        const deposit1Amount = ether(1);
        const deposit2Amount = ether(3);
        const totalDeposit = deposit1Amount.add(deposit2Amount);

        const account1 = owner;
        const account2 = feeRecipient;

        await setup.weth.connect(account1.wallet).approve(batchIssuanceModule.address, MAX_UINT_256);
        await setup.weth.connect(account2.wallet).approve(batchIssuanceModule.address, MAX_UINT_256);
        await setup.weth.connect(account1.wallet).transfer(feeRecipient.address, ether(3));

        const input1BalanceBefore = await setup.weth.balanceOf(account1.address);
        const input2BalanceBefore = await setup.weth.balanceOf(account2.address);
        await batchIssuanceModule.connect(account1.wallet).deposit(deposit1Amount);
        await batchIssuanceModule.connect(account2.wallet).deposit(deposit2Amount);
        const input1BalanceAfter = await setup.weth.balanceOf(account1.address);
        const input2BalanceAfter = await setup.weth.balanceOf(account2.address);

        const user1InputBalance = await batchIssuanceModule.inputBalanceOf(account1.address);
        const user2InputBalance = await batchIssuanceModule.inputBalanceOf(account2.address);
        const user1RoundInputBalance = await batchIssuanceModule.roundInputBalanceOf(0, account1.address);
        const user2RoundInputBalance = await batchIssuanceModule.roundInputBalanceOf(0, account2.address);
        const totalInputTokenBalance = await setup.weth.balanceOf(batchIssuanceModule.address);
        const roundsCount = await batchIssuanceModule.getRoundsCount();
        const userRoundsCount = await batchIssuanceModule.getUserRoundsCount(account1.address);

        expect(input1BalanceAfter).to.eq(input1BalanceBefore.sub(deposit1Amount));
        expect(input2BalanceAfter).to.eq(input2BalanceBefore.sub(deposit2Amount));
        expect(user1InputBalance).to.eq(deposit1Amount);
        expect(user2InputBalance).to.eq(deposit2Amount);
        expect(user1RoundInputBalance).to.eq(deposit1Amount);
        expect(user2RoundInputBalance).to.eq(deposit2Amount);
        expect(totalInputTokenBalance).to.eq(totalDeposit);
        expect(roundsCount).to.eq(1);
        expect(userRoundsCount).to.eq(1);
      });

      it("should generate additional rounds", async() => {
        const depositAmount = roundInputCap.mul(2);

        const inputBalanceBefore = await setup.weth.balanceOf(owner.address);
        await batchIssuanceModule.deposit(depositAmount);
        const inputBalanceAfter = await setup.weth.balanceOf(owner.address);

        const userInputBalance = await batchIssuanceModule.inputBalanceOf(owner.address);
        const userRound0InputBalance = await batchIssuanceModule.roundInputBalanceOf(0, owner.address);
        const userRound1InputBalance = await batchIssuanceModule.roundInputBalanceOf(0, owner.address);
        const totalInputTokenBalance = await setup.weth.balanceOf(batchIssuanceModule.address);
        const roundsCount = await batchIssuanceModule.getRoundsCount();
        const userRoundsCount = await batchIssuanceModule.getUserRoundsCount(owner.address);

        expect(inputBalanceAfter).to.eq(inputBalanceBefore.sub(depositAmount));
        expect(userInputBalance).to.eq(depositAmount);
        expect(userRound0InputBalance).to.eq(depositAmount.div(2));
        expect(userRound1InputBalance).to.eq(depositAmount.div(2));
        expect(totalInputTokenBalance).to.eq(depositAmount);
        expect(roundsCount).to.eq(2);
        expect(userRoundsCount).to.eq(2);
      });

      describe("when the current round is already partially baked", async () => {
        beforeEach(async () => {
          await batchIssuanceModule.deposit(ether(1));
          await batchIssuanceModule.connect(owner.wallet).setExchanges(
            ckComponents,
            [uniswapAdapterName, sushiswapAdapterName]
            );
          await batchIssuanceModule.batchIssue([0]);
        });

        it("should deposit create a new round", async() => {
          const depositAmount = ether("1");

          await batchIssuanceModule.deposit(depositAmount);

          const userInputBalance = await batchIssuanceModule.inputBalanceOf(owner.address);
          const userRound0InputBalance = await batchIssuanceModule.roundInputBalanceOf(0, owner.address);
          const userRound1InputBalance = await batchIssuanceModule.roundInputBalanceOf(1, owner.address);
          const totalInputTokenBalance = await setup.weth.balanceOf(batchIssuanceModule.address);
          const roundsCount = await batchIssuanceModule.getRoundsCount();
          const userRoundsCount = await batchIssuanceModule.getUserRoundsCount(owner.address);

          expect(userInputBalance).to.eq(depositAmount);
          expect(userRound0InputBalance).to.eq(0);
          expect(userRound1InputBalance).to.eq(depositAmount);
          expect(totalInputTokenBalance).to.eq(depositAmount);
          expect(roundsCount).to.eq(2);
          expect(userRoundsCount).to.eq(2);
        });
      });
    });

    describe("when deposit with ETH", async () => {
      beforeEach(async () => {
      });

      it("should deposit 1 eth", async() => {
        const depositAmount = ether(1);

        await batchIssuanceModule.depositEth({value: depositAmount});

        const userInputBalance = await batchIssuanceModule.inputBalanceOf(owner.address);
        const userRoundInputBalance = await batchIssuanceModule.roundInputBalanceOf(0, owner.address);
        const totalInputBalance = await setup.weth.balanceOf(batchIssuanceModule.address);
        const roundsCount = await batchIssuanceModule.getRoundsCount();
        const userRoundsCount = await batchIssuanceModule.getUserRoundsCount(owner.address);

        expect(userInputBalance).to.eq(depositAmount);
        expect(userRoundInputBalance).to.eq(depositAmount);
        expect(totalInputBalance).to.eq(depositAmount);
        expect(roundsCount).to.eq(1);
        expect(userRoundsCount).to.eq(1);
      });

      it("should deposit multiple times into a single round", async() => {
        const deposit1Amount = ether(1);
        const deposit2Amount = ether(3);
        const totalDeposit = deposit1Amount.add(deposit2Amount);

        await batchIssuanceModule.depositEth({ value: deposit1Amount });
        await batchIssuanceModule.depositEth({ value: deposit2Amount });

        const userInputBalance = await batchIssuanceModule.inputBalanceOf(owner.address);
        const userRoundInputBalance = await batchIssuanceModule.roundInputBalanceOf(0, owner.address);
        const totalInputBalance = await setup.weth.balanceOf(batchIssuanceModule.address);
        const roundsCount = await batchIssuanceModule.getRoundsCount();
        const userRoundsCount = await batchIssuanceModule.getUserRoundsCount(owner.address);

        expect(userInputBalance).to.eq(totalDeposit);
        expect(userRoundInputBalance).to.eq(totalDeposit);
        expect(totalInputBalance).to.eq(totalDeposit);
        expect(roundsCount).to.eq(1);
        expect(userRoundsCount).to.eq(1);
      });

      it("should deposit multiple times into a single round from different rounds", async() => {
        const deposit1Amount = ether(1);
        const deposit2Amount = ether(3);
        const totalDeposit = deposit1Amount.add(deposit2Amount);

        const account1 = owner;
        const account2 = feeRecipient;

        await batchIssuanceModule.connect(account1.wallet).depositEth({ value: deposit1Amount });
        await batchIssuanceModule.connect(account2.wallet).depositEth({ value:  deposit2Amount });

        const user1InputBalance = await batchIssuanceModule.inputBalanceOf(account1.address);
        const user2InputBalance = await batchIssuanceModule.inputBalanceOf(account2.address);
        const user1RoundInputBalance = await batchIssuanceModule.roundInputBalanceOf(0, account1.address);
        const user2RoundInputBalance = await batchIssuanceModule.roundInputBalanceOf(0, account2.address);
        const totalInputTokenBalance = await setup.weth.balanceOf(batchIssuanceModule.address);
        const roundsCount = await batchIssuanceModule.getRoundsCount();
        const userRoundsCount = await batchIssuanceModule.getUserRoundsCount(account1.address);

        expect(user1InputBalance).to.eq(deposit1Amount);
        expect(user2InputBalance).to.eq(deposit2Amount);
        expect(user1RoundInputBalance).to.eq(deposit1Amount);
        expect(user2RoundInputBalance).to.eq(deposit2Amount);
        expect(totalInputTokenBalance).to.eq(totalDeposit);
        expect(roundsCount).to.eq(1);
        expect(userRoundsCount).to.eq(1);
      });

      it("should generate additional rounds", async() => {
        const depositAmount = roundInputCap.mul(2);

        await batchIssuanceModule.depositEth({ value: depositAmount });

        const userInputBalance = await batchIssuanceModule.inputBalanceOf(owner.address);
        const userRound0InputBalance = await batchIssuanceModule.roundInputBalanceOf(0, owner.address);
        const userRound1InputBalance = await batchIssuanceModule.roundInputBalanceOf(0, owner.address);
        const totalInputTokenBalance = await setup.weth.balanceOf(batchIssuanceModule.address);
        const roundsCount = await batchIssuanceModule.getRoundsCount();
        const userRoundsCount = await batchIssuanceModule.getUserRoundsCount(owner.address);

        expect(userInputBalance).to.eq(depositAmount);
        expect(userRound0InputBalance).to.eq(depositAmount.div(2));
        expect(userRound1InputBalance).to.eq(depositAmount.div(2));
        expect(totalInputTokenBalance).to.eq(depositAmount);
        expect(roundsCount).to.eq(2);
        expect(userRoundsCount).to.eq(2);
      });

      describe("when the current round is already partially baked", async () => {
        beforeEach(async () => {
          await batchIssuanceModule.depositEth({ value: ether(1) });
          await batchIssuanceModule.connect(owner.wallet).setExchanges(
            ckComponents,
            [uniswapAdapterName, sushiswapAdapterName]
            );
          await batchIssuanceModule.batchIssue([0]);
        });

        it("should deposit create a new round", async() => {
          const depositAmount = ether("1");

          await batchIssuanceModule.depositEth({ value: depositAmount });

          const userInputBalance = await batchIssuanceModule.inputBalanceOf(owner.address);
          const userRound0InputBalance = await batchIssuanceModule.roundInputBalanceOf(0, owner.address);
          const userRound1InputBalance = await batchIssuanceModule.roundInputBalanceOf(1, owner.address);
          const totalInputTokenBalance = await setup.weth.balanceOf(batchIssuanceModule.address);
          const roundsCount = await batchIssuanceModule.getRoundsCount();
          const userRoundsCount = await batchIssuanceModule.getUserRoundsCount(owner.address);

          expect(userInputBalance).to.eq(depositAmount);
          expect(userRound0InputBalance).to.eq(0);
          expect(userRound1InputBalance).to.eq(depositAmount);
          expect(totalInputTokenBalance).to.eq(depositAmount);
          expect(roundsCount).to.eq(2);
          expect(userRoundsCount).to.eq(2);
        });
      });
    });
  });

  describe("#batchIssue", async() => {
    beforeEach(async () => {
      await setup.weth.approve(batchIssuanceModule.address, MAX_UINT_256);
      await batchIssuanceModule.connect(owner.wallet).setExchanges(
        ckComponents,
        [uniswapAdapterName, sushiswapAdapterName]
        );
    });

    it("should issue a single round", async() => {
      const depositAmount = ether(1);
      const expectedOutput = ether("1.181023319232159166");
      await batchIssuanceModule.deposit(depositAmount);
      await batchIssuanceModule.batchIssue([0]);

      const roundOutputBalance = await batchIssuanceModule.roundOutputBalanceOf(0, owner.address);
      const outputBalance = await batchIssuanceModule.outputBalanceOf(owner.address);
      const roundInputBalance = await batchIssuanceModule.roundInputBalanceOf(0, owner.address);
      const inputBalance = await batchIssuanceModule.inputBalanceOf(owner.address);

      expect(roundOutputBalance).to.eq(expectedOutput);
      expect(outputBalance).to.eq(expectedOutput);
      expect(roundInputBalance).to.eq(0);
      expect(inputBalance).to.eq(0);
    });

    it("should issue multi rounds", async() => {
      const depositAmount = roundInputCap.mul(2);
      const expectedOutput = ether("23.620466384643183332");
      await batchIssuanceModule.deposit(depositAmount);
      await batchIssuanceModule.batchIssue([0, 1]);

      const round0OutputBalance = await batchIssuanceModule.roundOutputBalanceOf(0, owner.address);
      const round1OutputBalance = await batchIssuanceModule.roundOutputBalanceOf(1, owner.address);
      const outputBalance = await batchIssuanceModule.outputBalanceOf(owner.address);
      const round0InputBalance = await batchIssuanceModule.roundInputBalanceOf(0, owner.address);
      const round1InputBalance = await batchIssuanceModule.roundInputBalanceOf(1, owner.address);
      const inputBalance = await batchIssuanceModule.inputBalanceOf(owner.address);

      expect(round0OutputBalance).to.eq(expectedOutput.div(2));
      expect(round1OutputBalance).to.eq(expectedOutput.div(2));
      expect(outputBalance).to.eq(expectedOutput);
      expect(round0InputBalance).to.eq(0);
      expect(round1InputBalance).to.eq(0);
      expect(inputBalance).to.eq(0);
    });

    it("issue the same round twice should revert", async() => {
        const depositAmount = ether(1);
        await batchIssuanceModule.deposit(depositAmount);

        await batchIssuanceModule.batchIssue([0]);
        await expect(batchIssuanceModule.batchIssue([0])).to.be.revertedWith("Quantity must be > 0");
    });
    it("issue rounds parameter should be ordered", async() => {
        const depositAmount = roundInputCap.mul(4);
        await batchIssuanceModule.deposit(depositAmount);

        await expect(batchIssuanceModule.batchIssue([1, 0, 3])).to.be.revertedWith("Rounds out of order");
    });
  });

  describe("#removeModule", async () => {
    let subjectCaller: Account;

    beforeEach(async () => {
      subjectCaller = owner;
    });

    async function subject(): Promise<any> {
      return batchIssuanceModule.connect(subjectCaller.wallet).removeModule();
    }

    it("should revert", async () => {
      await expect(subject()).to.be.revertedWith("The BatchIssuanceModule module cannot be removed");
    });
  });

  context("Manager admin functions", async () => {
    let subjectCaller: Account;

    let ckToken: CKToken;

    cacheBeforeEach(async () => {
      ckToken = await setup.createCKToken(
        [setup.weth.address],
        [ether(1)],
        [batchIssuanceModule.address]
      );

      const batchIssuanceHook = await getRandomAddress();
      const basicIssuanceModule = await getRandomAddress();
      const managerFeeRecipient = feeRecipient.address;
      // Set manager issue fee to 0.1% and redeem to 0.2%
      const managerFees = [ether(0.001), ether(0.002)] as [BigNumberish, BigNumberish];
      // Set max managerFee to 2%
      const maxManagerFee = ether(0.02);
      // Set min CKToken supply required
      const minCKTokenSupply = ether(100);
      // Set round cap limit
      const roundInputCap = ether(5);

      const batchIssuanceSetting = {
        feeRecipient: managerFeeRecipient,
        managerFees,
        maxManagerFee,
        minCKTokenSupply,
      } as BatchIssuanceSetting;

      await batchIssuanceModule.connect(owner.wallet).initialize(
        ckToken.address,
        basicIssuanceModule,
        batchIssuanceHook,
        batchIssuanceSetting,
        roundInputCap
      );

      const protocolDirectFee = ether(.02);
      await setup.controller.addFee(batchIssuanceModule.address, TWO, protocolDirectFee);

      const protocolManagerFee = ether(.3);
      await setup.controller.addFee(batchIssuanceModule.address, ZERO, protocolManagerFee);
    });

    describe("#editManagerFee", async () => {
      let subjectManagerFee: BigNumber;
      let subjectFeeIndex: BigNumber;

      beforeEach(async () => {
        subjectManagerFee = ether(0.01);
        subjectFeeIndex = ZERO;
        subjectCaller = owner;
      });

      async function subject(): Promise<any> {
        return batchIssuanceModule.connect(subjectCaller.wallet).editManagerFee(subjectManagerFee, subjectFeeIndex);
      }

      it("should edit the manager issue fee", async () => {
        await subject();
        const managerIssueFee = await batchIssuanceModule.getManagerFee(subjectFeeIndex);

        expect(managerIssueFee).to.eq(subjectManagerFee);
      });

      it("should emit correct ManagerFeeEdited event", async () => {
        await expect(subject()).to.emit(batchIssuanceModule, "ManagerFeeEdited").withArgs(
          subjectManagerFee,
          subjectFeeIndex
        );
      });

      describe("when editing the redeem fee", async () => {
        beforeEach(async () => {
          subjectManagerFee = ether(0.002);
          subjectFeeIndex = ONE;
        });

        it("should edit the manager redeem fee", async () => {
          await subject();
          const managerRedeemFee = await batchIssuanceModule.getManagerFee(subjectFeeIndex);

          expect(managerRedeemFee).to.eq(subjectManagerFee);
        });
      });

      shouldRevertIfTheCallerIsNotTheManager(subject);

      describe("when the manager fee is greater than maximum allowed", async () => {
        beforeEach(async () => {
          subjectManagerFee = ether(1);
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Manager fee must be less than maximum allowed");
        });
      });
    });

    describe("#editFeeRecipient", async () => {
      let subjectFeeRecipient: Address;

      beforeEach(async () => {
        subjectFeeRecipient = feeRecipient.address;
        subjectCaller = owner;
      });

      async function subject(): Promise<any> {
        return batchIssuanceModule.connect(subjectCaller.wallet).editFeeRecipient(subjectFeeRecipient);
      }

      it("should edit the manager fee recipient", async () => {
        await subject();
        const batchIssuanceSetting = await batchIssuanceModule.batchIssuanceSetting();
        expect(batchIssuanceSetting.feeRecipient).to.eq(subjectFeeRecipient);
      });

      it("should emit correct FeeRecipientEdited event", async () => {
        await expect(subject()).to.emit(batchIssuanceModule, "FeeRecipientEdited").withArgs(
          subjectFeeRecipient
        );
      });

      shouldRevertIfTheCallerIsNotTheManager(subject);

      describe("when the manager fee is greater than maximum allowed", async () => {
        beforeEach(async () => {
          subjectFeeRecipient = ADDRESS_ZERO;
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Fee recipient must not be 0 address");
        });
      });
    });

    describe("#editRoundInputCap", async () => {
      let subjectRoundInputCap: BigNumber;

      beforeEach(async () => {
        subjectRoundInputCap = ether(60);
        subjectCaller = owner;
      });

      async function subject(): Promise<any> {
        return batchIssuanceModule.connect(subjectCaller.wallet).editRoundInputCap(subjectRoundInputCap);
      }

      it("should edit the round input cap", async () => {
        await subject();
        const roundInputCap = await batchIssuanceModule.roundInputCap();
        expect(roundInputCap).to.eq(subjectRoundInputCap);
      });

      it("should emit correct RoundInputCapEdited event", async () => {
        const oldRoundInputCap = await batchIssuanceModule.roundInputCap();
        await expect(subject()).to.emit(batchIssuanceModule, "RoundInputCapEdited").withArgs(
          oldRoundInputCap,
          subjectRoundInputCap
        );
      });

      shouldRevertIfTheCallerIsNotTheManager(subject);
    });

    describe("#setExchanges", async () => {
      let subjectComponents: Address[];
      let subjectExchanges: string[];

      beforeEach(async () => {
        subjectCaller = owner;
        subjectComponents = [setup.dai.address, setup.wbtc.address];
        subjectExchanges = [uniswapAdapterName, sushiswapAdapterName];
      });

      async function subject(): Promise<ContractTransaction> {
        return await batchIssuanceModule.connect(subjectCaller.wallet).setExchanges(subjectComponents, subjectExchanges);
      }

      it("should set values correctly", async () => {
        await subject();

        for (let i = 0; i < subjectComponents.length; i++) {
          const exchangeName = (await batchIssuanceModule.tradeExecutionInfo(subjectComponents[i])).exchangeName;
          const expectedExchangeName = subjectExchanges[i];
          expect(exchangeName).to.be.eq(expectedExchangeName);
        }
      });

      describe("when array lengths are not same", async () => {
        beforeEach(async () => {
          subjectExchanges = [uniswapAdapterName];
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Array length mismatch");
        });
      });

      describe("when component array has duplilcate values", async () => {
        beforeEach(async () => {
          subjectComponents = [setup.dai.address, setup.wbtc.address, setup.dai.address];
          subjectExchanges = [uniswapAdapterName, sushiswapAdapterName, uniswapAdapterName];
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Cannot duplicate addresses");
        });
      });

      describe("when component array has duplilcate values", async () => {
        beforeEach(async () => {
          subjectComponents = [];
          subjectExchanges = [];
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Array length must be > 0");
        });
      });

      describe("when exchange is not a valid integration", async () => {
        beforeEach(async () => {
          await setup.integrationRegistry.removeIntegration(batchIssuanceModule.address, sushiswapAdapterName);
        });

        afterEach(async () => {
          await setup.integrationRegistry.addIntegration(
            batchIssuanceModule.address,
            sushiswapAdapterName,
            sushiswapExchangeAdapter.address
          );
        });

        describe("for component other than weth", async () => {
          it("should revert", async () => {
            await expect(subject()).to.be.revertedWith("Unrecognized exchange name");
          });
        });

        describe("for weth", async () => {
          beforeEach(async () => {
            subjectComponents = [setup.dai.address, setup.weth.address];
          });

          it("should not revert", async () => {
            await expect(subject()).to.not.be.reverted;
          });
        });
      });
    });

    function shouldRevertIfTheCallerIsNotTheManager(subject: any) {
      describe("when the caller is not the manager", async () => {
        beforeEach(async () => {
          subjectCaller = await getRandomAccount();
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Must be the CKToken manager");
        });
      });
    }
  });

  describe("#withdraw", async () => {
    beforeEach(async () => {
      await setup.weth.approve(batchIssuanceModule.address, MAX_UINT_256);
      await batchIssuanceModule.connect(owner.wallet).setExchanges(
        ckComponents,
        [uniswapAdapterName, sushiswapAdapterName]
        );
    });

    describe("when fully baked", async () => {
      it("should withdraw simply", async () => {
        const depositAmount = ether(1);
        const expectedOutput = ether("11.181023319232159166");
        await batchIssuanceModule.deposit(depositAmount);

        await batchIssuanceModule.batchIssue([0]);

        batchIssuanceModule.withdraw(MAX_UINT_256);

        const outputBalance = await batchIssuanceModule.outputBalanceOf(owner.address);
        const roundOutputBalance = await batchIssuanceModule.roundOutputBalanceOf(0, owner.address);
        const outputTokenBalance = await ckToken.balanceOf(owner.address);

        expect(outputBalance).to.eq(0);
        expect(roundOutputBalance).to.eq(0);
        expect(outputTokenBalance).to.eq(expectedOutput);
      });
    });

    describe("when not baked at all", async () => {
      it("should withdraw simply", async () => {
        const depositAmount = ether(1);
        await batchIssuanceModule.deposit(depositAmount);

        const inputTokenBalanceBefore = await setup.weth.balanceOf(owner.address);
        const outputTokenBalanceBefore = await ckToken.balanceOf(owner.address);

        await batchIssuanceModule.withdraw(MAX_UINT_256);

        const inputBalanceAfter = await batchIssuanceModule.inputBalanceOf(owner.address);
        const roundInputBalanceAfter = await batchIssuanceModule.roundInputBalanceOf(0, owner.address);
        const inputTokenBalanceAfter = await setup.weth.balanceOf(owner.address);
        const outputBalanceAfter = await batchIssuanceModule.outputBalanceOf(owner.address);
        const roundOutputBalanceAfter = await batchIssuanceModule.roundOutputBalanceOf(0, owner.address);
        const outputTokenBalanceAfter = await ckToken.balanceOf(owner.address);

        expect(inputBalanceAfter).to.eq(0);
        expect(roundInputBalanceAfter).to.eq(0);
        expect(inputTokenBalanceAfter).to.eq(inputTokenBalanceBefore.add(depositAmount));
        expect(outputBalanceAfter).to.eq(0);
        expect(roundOutputBalanceAfter).to.eq(0);
        expect(outputTokenBalanceAfter).to.eq(outputTokenBalanceBefore);
      });
    });

    describe("when baked in 3 rounds", async () => {
      it("should withdraw", async () => {
        const depositAmount = roundInputCap.mul(3);
        const expectedOutput = ether("35.430699576964774998");
        await batchIssuanceModule.deposit(depositAmount);
        await batchIssuanceModule.batchIssue([0, 1, 2]);

        const inputTokenBalanceBefore = await setup.weth.balanceOf(owner.address);
        const outputTokenBalanceBefore = await ckToken.balanceOf(owner.address);

        await batchIssuanceModule.withdraw(MAX_UINT_256);

        const inputBalanceAfter = await batchIssuanceModule.inputBalanceOf(owner.address);
        const roundInputBalanceAfter = await batchIssuanceModule.roundInputBalanceOf(0, owner.address);
        const inputTokenBalanceAfter = await setup.weth.balanceOf(owner.address);
        const outputBalanceAfter = await batchIssuanceModule.outputBalanceOf(owner.address);
        const roundOutputBalanceAfter = await batchIssuanceModule.roundOutputBalanceOf(0, owner.address);
        const outputTokenBalanceAfter = await ckToken.balanceOf(owner.address);

        expect(inputBalanceAfter).to.eq(0);
        expect(roundInputBalanceAfter).to.eq(0);
        expect(inputTokenBalanceAfter).to.eq(inputTokenBalanceBefore);
        expect(outputBalanceAfter).to.eq(0);
        expect(roundOutputBalanceAfter).to.eq(0);
        expect(outputTokenBalanceAfter).to.eq(outputTokenBalanceBefore.add(expectedOutput));
      });
    });

    describe("when backed multiple users deposits", async () => {
      it("Withdraw math accuracy", async() => {
        const account1 = owner;
        const account2 = feeRecipient;

        await batchIssuanceModule.deposit(ether(2)); // deposit 2ETH
        await setup.weth.connect(account2.wallet).approve(batchIssuanceModule.address, MAX_UINT_256);
        await batchIssuanceModule.connect(account2.wallet).deposit(ether(1)); // deposit 1ETH

        await batchIssuanceModule.batchIssue([0]);

        await batchIssuanceModule.connect(account2.wallet).withdraw(2); // success
        await batchIssuanceModule.connect(account1.wallet).withdraw(2); // error! revert ERC20: transfer amount exceeds balance
      });
    });
  });
});
