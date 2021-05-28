import "module-alias/register";
import { BigNumber } from "@ethersproject/bignumber";

import { Address } from "@utils/types";
import { Account } from "@utils/test/types";
import { ADDRESS_ZERO, ZERO } from "@utils/constants";
import { AirdropModule, CurveStakingAdapter, CKToken, StakingModule, StandardTokenMock } from "@utils/contracts";
import DeployHelper from "@utils/deploys";
import {
  ether,
} from "@utils/index";
import {
  getAccounts,
  getWaffleExpect,
  getSystemFixture,
  getCurveFixture,
  addSnapshotBeforeRestoreAfterEach,
} from "@utils/test/index";
import { CurveFixture, SystemFixture } from "@utils/fixtures";
import { LiquidityGauge } from "@utils/contracts/curve";

const expect = getWaffleExpect();

describe("curveStakingModule", () => {
  let owner: Account;
  let deployer: DeployHelper;
  let setup: SystemFixture;
  let stakingModule: StakingModule;
  let curveStaking: CurveStakingAdapter;
  let airdropModule: AirdropModule;

  let curveSetup: CurveFixture;
  let usdt: StandardTokenMock;
  let susd: StandardTokenMock;
  let gauge: LiquidityGauge;

  const curveStakingAdapterIntegrationName: string = "CURVE_STAKE";

  before(async () => {
    [
      owner,
    ] = await getAccounts();

    deployer = new DeployHelper(owner.wallet);
    setup = getSystemFixture(owner.address);
    await setup.initialize();
    // Add owner.address as module so it can call invoke method
    await setup.controller.addModule(owner.address);

    // Extra tokens setup
    usdt = await deployer.mocks.deployTokenMock(owner.address, ether(10000), 6);
    susd = await deployer.mocks.deployTokenMock(owner.address, ether(10000), 18);

    // Curve system setup
    curveSetup = getCurveFixture(owner.address);
    await curveSetup.initializePool([setup.dai.address, setup.usdc.address, usdt.address, susd.address]);
    await curveSetup.initializeDAO();
    gauge = await curveSetup.initializeGauge(curveSetup.poolToken.address);

    // Add staking module
    stakingModule = await deployer.modules.deployStakingModule(setup.controller.address);
    await setup.controller.addModule(stakingModule.address);

    // Add Curve Staking Module Adapter
    curveStaking = await deployer.adapters.deployCurveStakingAdapter(curveSetup.gaugeController.address);
    await setup.integrationRegistry.addIntegration(stakingModule.address, curveStakingAdapterIntegrationName, curveStaking.address);

    // Add airdrop module to absorb the lp token
    airdropModule = await deployer.modules.deployAirdropModule(setup.controller.address);
    await setup.controller.addModule(airdropModule.address);

    // Add some base liquidity to the curve pool
    const subject18DecimalAmount = ether(10);
    const subject6DecimalAmount = 10000000;
    await setup.dai.approve(curveSetup.deposit.address, subject18DecimalAmount);
    await setup.usdc.approve(curveSetup.deposit.address, subject6DecimalAmount);
    await usdt.approve(curveSetup.deposit.address, subject6DecimalAmount);
    await susd.approve(curveSetup.deposit.address, subject18DecimalAmount);

    await curveSetup.deposit.add_liquidity(
      [subject18DecimalAmount, subject6DecimalAmount, subject6DecimalAmount, subject18DecimalAmount],
      0,
      {
        gasLimit: 5000000,
      });
  });

  addSnapshotBeforeRestoreAfterEach();
  context("when a CKToken has been deployed and issued", async () => {
    let ckToken: CKToken;
    let ckTokensIssued: BigNumber;

    before(async () => {
      ckToken = await setup.createCKToken(
        [setup.dai.address],
        [ether(1)],
        [setup.issuanceModule.address, stakingModule.address, airdropModule.address, owner.address]
      );

      // Initialize modules
      await ckToken.initializeModule(); // initializes owner.address module
      await setup.issuanceModule.initialize(ckToken.address, ADDRESS_ZERO);
      await stakingModule.initialize(
        ckToken.address
      );
      await airdropModule.initialize(ckToken.address, {
        airdrops: [curveSetup.poolToken.address],
        airdropFee: ZERO,
        anyoneAbsorb: true,
        feeRecipient: ADDRESS_ZERO,
      });

      // Issue some CKs
      ckTokensIssued = ether(10);
      const underlyingRequired = ckTokensIssued;
      await setup.dai.approve(setup.controller.address, underlyingRequired);
      await setup.issuanceModule.issue(ckToken.address, ckTokensIssued, owner.address);
    });

    describe("when a CKToken provided liquidity", async () => {
      let subjectStakingContract: Address;
      let subjectCKToken: Address;
      let subjectComponent: Address;

      beforeEach(async () => {
        subjectCKToken = ckToken.address;
        subjectStakingContract = gauge.address;
        subjectComponent = curveSetup.poolToken.address;
        const amount = ether(10);

        // Add liquidity to pool
        const approveDepositCallData = setup.dai.interface.encodeFunctionData("approve", [curveSetup.deposit.address, amount]);
        await ckToken.invoke(setup.dai.address, ZERO, approveDepositCallData);

        const addLiquidityCallData = curveSetup.deposit.interface.encodeFunctionData("add_liquidity", [[amount, 0, 0, 0], 0]);
        await ckToken.invoke(curveSetup.deposit.address, ZERO, addLiquidityCallData, {
          gasLimit: 5000000,
        });

        // Absorb the lp token into the CKToken
        await airdropModule.absorb(subjectCKToken, subjectComponent);
      });

      async function subject(): Promise<any> {
        return stakingModule.stake(
          subjectCKToken,
          subjectStakingContract,
          subjectComponent,
          curveStakingAdapterIntegrationName,
          ether(.5),
          {
            gasLimit: 5000000,
          }
        );
      }

      it("should be able to stake lp tokens to gauge", async () => {
        const prevBalance = await curveSetup.poolToken.balanceOf(subjectCKToken);

        await subject();

        const balance = await curveSetup.poolToken.balanceOf(subjectCKToken);
        expect(balance).to.lt(prevBalance);
      });

      describe("when a CKToken staked lp tokens", async () => {

        beforeEach(async () => {
          await stakingModule.stake(
            subjectCKToken,
            subjectStakingContract,
            subjectComponent,
            curveStakingAdapterIntegrationName,
            ether(.5),
            {
              gasLimit: 5000000,
            }
          );
        });

        async function subject(): Promise<any> {
          await stakingModule.unstake(
            subjectCKToken,
            subjectStakingContract,
            subjectComponent,
            curveStakingAdapterIntegrationName,
            ether(.5),
            {
              gasLimit: 5000000,
            }
          );
        }

        it("should be able to withdraw", async () => {
          const prevBalance = await curveSetup.poolToken.balanceOf(subjectCKToken);

          await subject();

          const balance = await curveSetup.poolToken.balanceOf(subjectCKToken);
          expect(balance).to.gt(prevBalance);
        });
      });
    });
  });
});
