import "module-alias/register";
import { BigNumber } from "@ethersproject/bignumber";

import { Address, StreamingFeeState } from "@utils/types";
import { Account } from "@utils/test/types";
import { ADDRESS_ZERO, MAX_UINT_256, PRECISE_UNIT, THREE, ZERO, ONE_DAY_IN_SECONDS } from "@utils/constants";
import { BalancerV1IndexExchangeAdapter, ContractCallerMock, GeneralIndexModule, CKToken, UniswapV2IndexExchangeAdapter } from "@utils/contracts";
import DeployHelper from "@utils/deploys";
import {
  bitcoin,
  ether,
  preciseDiv,
  preciseMul,
  preciseMulCeil
} from "@utils/index";
import {
  cacheBeforeEach,
  increaseTimeAsync,
  getAccounts,
  getBalancerFixture,
  getLastBlockTimestamp,
  getRandomAccount,
  getRandomAddress,
  getSystemFixture,
  getUniswapFixture,
  getWaffleExpect
} from "@utils/test/index";
import { BalancerFixture, SystemFixture, UniswapFixture } from "@utils/fixtures";
import { ContractTransaction } from "ethers";

const expect = getWaffleExpect();

describe("GeneralIndexModule", () => {
  let owner: Account;
  let trader: Account;
  let positionModule: Account;
  let deployer: DeployHelper;
  let setup: SystemFixture;

  let uniswapSetup: UniswapFixture;
  let sushiswapSetup: UniswapFixture;
  let balancerSetup: BalancerFixture;

  let index: CKToken;
  let indexWithWeth: CKToken;
  let indexModule: GeneralIndexModule;

  let balancerExchangeAdapter: BalancerV1IndexExchangeAdapter;
  let balancerAdapterName: string;
  let sushiswapExchangeAdapter: UniswapV2IndexExchangeAdapter;
  let sushiswapAdapterName: string;
  let uniswapExchangeAdapter: UniswapV2IndexExchangeAdapter;
  let uniswapAdapterName: string;

  let indexComponents: Address[];
  let indexUnits: BigNumber[];
  let indexWithWethComponents: Address[];
  let indexWithWethUnits: BigNumber[];

  const ONE_MINUTE_IN_SECONDS: BigNumber = BigNumber.from(60);

  before(async () => {
    [
      owner,
      trader,
      positionModule,
    ] = await getAccounts();

    deployer = new DeployHelper(owner.wallet);
    setup = getSystemFixture(owner.address);
    uniswapSetup = getUniswapFixture(owner.address);
    sushiswapSetup = getUniswapFixture(owner.address);
    balancerSetup = getBalancerFixture(owner.address);

    await setup.initialize();
    await uniswapSetup.initialize(owner, setup.weth.address, setup.wbtc.address, setup.dai.address);
    await sushiswapSetup.initialize(owner, setup.weth.address, setup.wbtc.address, setup.dai.address);
    await balancerSetup.initialize(owner, setup.weth, setup.wbtc, setup.dai);

    indexModule = await deployer.modules.deployGeneralIndexModule(
      setup.controller.address,
      setup.weth.address
    );
    await setup.controller.addModule(indexModule.address);
    await setup.controller.addModule(positionModule.address);

    balancerExchangeAdapter = await deployer.modules.deployBalancerV1IndexExchangeAdapter(balancerSetup.exchange.address);
    sushiswapExchangeAdapter = await deployer.modules.deployUniswapV2IndexExchangeAdapter(sushiswapSetup.router.address);
    uniswapExchangeAdapter = await deployer.modules.deployUniswapV2IndexExchangeAdapter(uniswapSetup.router.address);

    balancerAdapterName = "BALANCER";
    sushiswapAdapterName = "SUSHISWAP";
    uniswapAdapterName = "UNISWAP";


    await setup.integrationRegistry.batchAddIntegration(
      [indexModule.address, indexModule.address, indexModule.address],
      [balancerAdapterName, sushiswapAdapterName, uniswapAdapterName],
      [
        balancerExchangeAdapter.address,
        sushiswapExchangeAdapter.address,
        uniswapExchangeAdapter.address,
      ]
    );
  });

  cacheBeforeEach(async () => {
    indexComponents = [uniswapSetup.uni.address, setup.wbtc.address, setup.dai.address];
    indexUnits = [ether(86.9565217), bitcoin(.01111111), ether(100)];
    index = await setup.createCKToken(
      indexComponents,
      indexUnits,               // $100 of each
      [setup.issuanceModule.address, setup.streamingFeeModule.address, indexModule.address, positionModule.address],
    );

    const feeSettings = {
      feeRecipient: owner.address,
      maxStreamingFeePercentage: ether(.1),
      streamingFeePercentage: ether(.01),
      lastStreamingFeeTimestamp: ZERO,
    } as StreamingFeeState;

    await setup.streamingFeeModule.initialize(index.address, feeSettings);
    await setup.issuanceModule.initialize(index.address, ADDRESS_ZERO);
    await index.connect(positionModule.wallet).initializeModule();

    indexWithWethComponents = [uniswapSetup.uni.address, setup.wbtc.address, setup.dai.address, setup.weth.address];
    indexWithWethUnits = [ether(86.9565217), bitcoin(.01111111), ether(100), ether(0.434782609)];
    indexWithWeth = await setup.createCKToken(
      indexWithWethComponents,
      indexWithWethUnits,               // $100 of each
      [setup.issuanceModule.address, setup.streamingFeeModule.address, indexModule.address],
    );

    const feeSettingsForIndexWithWeth = {
      feeRecipient: owner.address,
      maxStreamingFeePercentage: ether(.1),
      streamingFeePercentage: ether(.01),
      lastStreamingFeeTimestamp: ZERO,
    } as StreamingFeeState;

    await setup.streamingFeeModule.initialize(indexWithWeth.address, feeSettingsForIndexWithWeth);
    await setup.issuanceModule.initialize(indexWithWeth.address, ADDRESS_ZERO);

    await setup.weth.connect(owner.wallet).approve(uniswapSetup.router.address, ether(2000));
    await uniswapSetup.uni.connect(owner.wallet).approve(uniswapSetup.router.address, ether(400000));
    await uniswapSetup.router.connect(owner.wallet).addLiquidity(
      setup.weth.address,
      uniswapSetup.uni.address,
      ether(2000),
      ether(400000),
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
  });

  describe("#constructor", async () => {
    it("should set all the parameters correctly", async () => {
      const weth = await indexModule.weth();
      const controller = await indexModule.controller();

      expect(weth).to.eq(setup.weth.address);
      expect(controller).to.eq(setup.controller.address);
    });
  });

  describe("#initialize", async () => {
    let subjectCKToken: CKToken;
    let subjectCaller: Account;

    beforeEach(async () => {
      subjectCKToken = index;
      subjectCaller = owner;
    });

    async function subject(): Promise<any> {
      indexModule = indexModule.connect(subjectCaller.wallet);
      return indexModule.initialize(subjectCKToken.address);
    }

    it("should enable the Module on the CKToken", async () => {
      await subject();
      const isModuleEnabled = await subjectCKToken.isInitializedModule(indexModule.address);
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

    describe("when the module is not pending", async () => {
      beforeEach(async () => {
        await subject();
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Must be pending initialization");
      });
    });

    describe("when the CKToken is not enabled on the controller", async () => {
      beforeEach(async () => {
        const nonEnabledCKToken = await setup.createNonControllerEnabledCKToken(
          [setup.dai.address],
          [ether(1)],
          [indexModule.address],
          owner.address
        );

        subjectCKToken = nonEnabledCKToken;
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Must be controller-enabled CKToken");
      });
    });

    describe("when set has weth as component", async () => {
      beforeEach(async () => {
        subjectCKToken = indexWithWeth;
      });

      it("should enable the Module on the CKToken", async () => {
        await subject();
        const isModuleEnabled = await subjectCKToken.isInitializedModule(indexModule.address);
        expect(isModuleEnabled).to.eq(true);
      });
    });

    describe("when there are external positions for a component", async () => {
      beforeEach(async () => {
        await subjectCKToken.connect(positionModule.wallet)
          .addExternalPositionModule(indexComponents[0], positionModule.address);
        });

        afterEach(async () => {
          await subjectCKToken.connect(positionModule.wallet)
            .removeExternalPositionModule(indexComponents[0], positionModule.address);
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("External positions not allowed");
        });
      });
  });

  describe("when module is initalized", async () => {
    let subjectCKToken: CKToken;
    let subjectCaller: Account;

    let newComponents: Address[];
    let newTargetUnits: BigNumber[];
    let oldTargetUnits: BigNumber[];
    let issueAmount: BigNumber;

    async function initCKToken(
      ckToken: CKToken, components: Address[], tradeMaximums: BigNumber[], exchanges: string[], coolOffPeriods: BigNumber[]
    ) {
      await indexModule.initialize(ckToken.address);
      await indexModule.setTradeMaximums(ckToken.address, components, tradeMaximums);
      await indexModule.setExchanges(ckToken.address, components, exchanges);
      await indexModule.setCoolOffPeriods(ckToken.address, components, coolOffPeriods);
      await indexModule.setTraderStatus(ckToken.address, [trader.address], [true]);
    }

    cacheBeforeEach(async () => {
      // initialize indexModule on both CKTokens
      await initCKToken(
        index,
       [uniswapSetup.uni.address, setup.wbtc.address, setup.dai.address, sushiswapSetup.uni.address],
       [ether(800), bitcoin(.1), ether(1000), ether(500)],
       [uniswapAdapterName, sushiswapAdapterName, balancerAdapterName, sushiswapAdapterName],
       [ONE_MINUTE_IN_SECONDS.mul(3), ONE_MINUTE_IN_SECONDS, ONE_MINUTE_IN_SECONDS.mul(2), ONE_MINUTE_IN_SECONDS]
      );

      await initCKToken(
        indexWithWeth,
        [uniswapSetup.uni.address, setup.wbtc.address, setup.dai.address, setup.weth.address, sushiswapSetup.uni.address],
        [ether(800), bitcoin(.1), ether(1000), ether(10000), ether(500)],
        [uniswapAdapterName, sushiswapAdapterName, balancerAdapterName, "", sushiswapAdapterName],
        [ONE_MINUTE_IN_SECONDS.mul(3), ONE_MINUTE_IN_SECONDS, ONE_MINUTE_IN_SECONDS.mul(2), ZERO, ONE_MINUTE_IN_SECONDS],
      );
    });

    describe("#startRebalance", async () => {
      let subjectNewComponents: Address[];
      let subjectNewTargetUnits: BigNumber[];
      let subjectOldTargetUnits: BigNumber[];

      beforeEach(async () => {
        subjectCKToken = index;
        subjectCaller = owner;

        subjectNewComponents = [sushiswapSetup.uni.address];
        subjectNewTargetUnits = [ether(50)];
        subjectOldTargetUnits = [ether("60.869565780223716593"), bitcoin(.02), ether(50)];
      });

      async function subject(): Promise<ContractTransaction> {
        return await indexModule.connect(subjectCaller.wallet).startRebalance(
          subjectCKToken.address,
          subjectNewComponents,
          subjectNewTargetUnits,
          subjectOldTargetUnits,
          await subjectCKToken.positionMultiplier()
        );
      }

      it("should set target units and rebalance info correctly", async () => {
        await subject();

        const currentComponents = await subjectCKToken.getComponents();
        const aggregateComponents = [...currentComponents, ...subjectNewComponents];
        const aggregateTargetUnits = [...subjectOldTargetUnits, ...subjectNewTargetUnits];

        for (let i = 0; i < aggregateComponents.length; i++) {
          const targetUnit = (await indexModule.executionInfo(subjectCKToken.address, aggregateComponents[i])).targetUnit;
          const exepectedTargetUnit = aggregateTargetUnits[i];
          expect(targetUnit).to.be.eq(exepectedTargetUnit);
        }

        const rebalanceComponents = await indexModule.getRebalanceComponents(subjectCKToken.address);
        const expectedRebalanceComponents = aggregateComponents;
        for (let i = 0; i < rebalanceComponents.length; i++) {
          expect(rebalanceComponents[i]).to.be.eq(expectedRebalanceComponents[i]);
        }

        const positionMultiplier = (await indexModule.rebalanceInfo(subjectCKToken.address)).positionMultiplier;
        const expectedPositionMultiplier = await subjectCKToken.positionMultiplier();

        expect(positionMultiplier).to.be.eq(expectedPositionMultiplier);
      });

      it("emits the correct RebalanceStarted event", async () => {
        const currentComponents = await subjectCKToken.getComponents();
        const expectedAggregateComponents = [...currentComponents, ...subjectNewComponents];
        const expectedAggregateTargetUnits = [...subjectOldTargetUnits, ...subjectNewTargetUnits];
        const expectedPositionMultiplier = await subjectCKToken.positionMultiplier();

        await expect(subject())
          .to.emit(indexModule, "RebalanceStarted")
          .withArgs(
            subjectCKToken.address,
            expectedAggregateComponents,
            expectedAggregateTargetUnits,
            expectedPositionMultiplier,
          );
      });

      describe("newComponents and newComponentsTargetUnits are not of same length", async () => {
        beforeEach(async () => {
          subjectNewTargetUnits = [];
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Array length mismatch");
        });
      });

      describe("when missing target units for old comoponents", async () => {
        beforeEach(async () => {
          subjectOldTargetUnits = [ether("60.869565780223716593"), bitcoin(.02)];
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Old Components targets missing");
        });
      });

      describe("when newComponents contains an old component", async () => {
        beforeEach(async () => {
          subjectNewComponents = [sushiswapSetup.uni.address, uniswapSetup.uni.address];
          subjectNewTargetUnits = [ether(50), ether(50)];
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Cannot duplicate components");
        });
      });

      describe("when there are external positions for a component", async () => {
        beforeEach(async () => {
          await subjectCKToken.connect(positionModule.wallet).addExternalPositionModule(
            subjectNewComponents[0],
            positionModule.address
          );
        });

        afterEach(async () => {
          await subjectCKToken.connect(positionModule.wallet).removeExternalPositionModule(
            subjectNewComponents[0],
            positionModule.address
          );
        });

        it("should revert", async() => {
          await expect(subject()).to.be.revertedWith("External positions not allowed");
        });
      });
    });

    describe("#setCoolOffPeriods", async () => {
      let subjectComponents: Address[];
      let subjectCoolOffPeriods: BigNumber[];

      beforeEach(async () => {
        subjectCKToken = index;
        subjectCaller = owner;
        subjectComponents = [uniswapSetup.uni.address, setup.wbtc.address];
        subjectCoolOffPeriods = [ONE_MINUTE_IN_SECONDS.mul(3), ONE_MINUTE_IN_SECONDS];
      });

      async function subject(): Promise<ContractTransaction> {
        return await indexModule.connect(subjectCaller.wallet).setCoolOffPeriods(
          subjectCKToken.address,
          subjectComponents,
          subjectCoolOffPeriods
        );
      }

      it("should set values correctly", async () => {
        await subject();

        for (let i = 0; i < subjectComponents.length; i++) {
          const coolOffPeriod = (await indexModule.executionInfo(subjectCKToken.address, subjectComponents[i])).coolOffPeriod;
          const exepctedCoolOffPeriod = subjectCoolOffPeriods[i];
          expect(coolOffPeriod).to.be.eq(exepctedCoolOffPeriod);
        }
      });

      describe("when array lengths are not same", async () => {
        beforeEach(async () => {
          subjectCoolOffPeriods = [ONE_MINUTE_IN_SECONDS.mul(3), ONE_MINUTE_IN_SECONDS, ONE_MINUTE_IN_SECONDS.mul(2)];
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Array length mismatch");
        });
      });

      describe("when component array has duplilcate values", async () => {
        beforeEach(async () => {
          subjectComponents = [uniswapSetup.uni.address, setup.wbtc.address, uniswapSetup.uni.address];
          subjectCoolOffPeriods = [ONE_MINUTE_IN_SECONDS.mul(3), ONE_MINUTE_IN_SECONDS, ONE_MINUTE_IN_SECONDS.mul(3)];
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Cannot duplicate addresses");
        });
      });

      describe("when array length is 0", async () => {
        beforeEach(async () => {
          subjectComponents = [];
          subjectCoolOffPeriods = [];
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Array length must be > 0");
        });
      });
    });

    describe("#setTradeMaximums", async () => {
      let subjectComponents: Address[];
      let subjectTradeMaximums: BigNumber[];

      beforeEach(async () => {
        subjectCKToken = index;
        subjectCaller = owner;
        subjectComponents = [uniswapSetup.uni.address, setup.wbtc.address];
        subjectTradeMaximums = [ether(800), bitcoin(.1)];
      });

      async function subject(): Promise<ContractTransaction> {
        return await indexModule.connect(subjectCaller.wallet).setTradeMaximums(
          subjectCKToken.address,
          subjectComponents,
          subjectTradeMaximums
        );
      }

      it("should set values correctly", async () => {
        await subject();

        for (let i = 0; i < subjectComponents.length; i++) {
          const maxSize = (await indexModule.executionInfo(subjectCKToken.address, subjectComponents[i])).maxSize;
          const exepctedMaxSize = subjectTradeMaximums[i];
          expect(maxSize).to.be.eq(exepctedMaxSize);
        }
      });
    });

    describe("#setExchanges", async () => {
      let subjectComponents: Address[];
      let subjectExchanges: string[];

      beforeEach(async () => {
        subjectCKToken = index;
        subjectCaller = owner;
        subjectComponents = [uniswapSetup.uni.address, setup.wbtc.address];
        subjectExchanges = [uniswapAdapterName, sushiswapAdapterName];
      });

      async function subject(): Promise<ContractTransaction> {
        return await indexModule.connect(subjectCaller.wallet).setExchanges(subjectCKToken.address, subjectComponents, subjectExchanges);
      }

      it("should set values correctly", async () => {
        await subject();

        for (let i = 0; i < subjectComponents.length; i++) {
          const exchangeName = (await indexModule.executionInfo(subjectCKToken.address, subjectComponents[i])).exchangeName;
          const expectedExchangeName = subjectExchanges[i];
          expect(exchangeName).to.be.eq(expectedExchangeName);
        }
      });

      describe("when array lengths are not same", async () => {
        beforeEach(async () => {
          subjectExchanges = [uniswapAdapterName, sushiswapAdapterName, balancerAdapterName];
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Array length mismatch");
        });
      });

      describe("when component array has duplilcate values", async () => {
        beforeEach(async () => {
          subjectComponents = [uniswapSetup.uni.address, setup.wbtc.address, uniswapSetup.uni.address];
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
          await setup.integrationRegistry.removeIntegration(indexModule.address, sushiswapAdapterName);
        });

        afterEach(async () => {
          await setup.integrationRegistry.addIntegration(
            indexModule.address,
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
            subjectComponents = [sushiswapSetup.uni.address, setup.weth.address];
          });

          it("should not revert", async () => {
            await expect(subject()).to.not.be.reverted;
          });
        });
      });
    });

    describe("#setExchangeData", async () => {
      let uniBytes: string;
      let wbtcBytes: string;

      let subjectComponents: Address[];
      let subjectExchangeData: string[];

      beforeEach(async () => {
        uniBytes = "0x";
        wbtcBytes = "0x7890";

        subjectCKToken = index;
        subjectCaller = owner;
        subjectComponents = [uniswapSetup.uni.address, setup.wbtc.address];
        subjectExchangeData = [uniBytes, wbtcBytes];
      });

      async function subject(): Promise<ContractTransaction> {
        return await indexModule.connect(subjectCaller.wallet).setExchangeData(subjectCKToken.address, subjectComponents, subjectExchangeData);
      }

      it("should set values correctly", async () => {
        await subject();

        for (let i = 0; i < subjectComponents.length; i++) {
          const exchangeData = (await indexModule.executionInfo(subjectCKToken.address, subjectComponents[i])).exchangeData;
          const expectedExchangeData = subjectExchangeData[i];
          expect(exchangeData).to.be.eq(expectedExchangeData);
        }
      });

      describe("when array lengths are not same", async () => {
        beforeEach(async () => {
          subjectExchangeData = ["0x", "0x523454", "0x7890"];
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Array length mismatch");
        });
      });

      describe("when component array has duplicate values", async () => {
        beforeEach(async () => {
          subjectComponents = [uniswapSetup.uni.address, setup.wbtc.address, uniswapSetup.uni.address];
          subjectExchangeData = ["0x", "0x523454", "0x7890"];
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Cannot duplicate addresses");
        });
      });

      describe("when component array has no values", async () => {
        beforeEach(async () => {
          subjectComponents = [];
          subjectExchangeData = [];
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Array length must be > 0");
        });
      });
    });

    describe("#trade", async () => {
      let subjectComponent: Address;
      let subjectIncreaseTime: BigNumber;
      let subjectEthQuantityLimit: BigNumber;

      let expectedOut: BigNumber;

      before(async () => {
        // current units [ether(86.9565217), bitcoin(.01111111), ether(100), ZERO]
        newComponents = [];
        oldTargetUnits = [ether("60.869565780223716593"), bitcoin(.02), ether(50)];
        newTargetUnits = [];
        issueAmount = ether("20.000000000000000001");
      });

      const startRebalance = async () => {
        await setup.approveAndIssueCKToken(subjectCKToken, issueAmount);
        await indexModule.startRebalance(
          subjectCKToken.address,
          newComponents,
          newTargetUnits,
          oldTargetUnits,
          await index.positionMultiplier()
        );
      };

      const initializeSubjectVariables = () => {
        subjectCKToken = index;
        subjectCaller = trader;
        subjectComponent = setup.dai.address;
        subjectIncreaseTime = ONE_MINUTE_IN_SECONDS.mul(5);
        subjectEthQuantityLimit = ZERO;
      };

      async function subject(): Promise<ContractTransaction> {
        await increaseTimeAsync(subjectIncreaseTime);
        return await indexModule.connect(subjectCaller.wallet).trade(
          subjectCKToken.address,
          subjectComponent,
          subjectEthQuantityLimit
        );
      }

      describe("with default target units", async () => {
        beforeEach(async () => {
          initializeSubjectVariables();

          expectedOut = (await balancerSetup.exchange.viewSplitExactIn(
            setup.dai.address,
            setup.weth.address,
            ether(1000),
            THREE
          )).totalOutput;
          subjectEthQuantityLimit = expectedOut;
        });
        cacheBeforeEach(startRebalance);

        it("the position units and lastTradeTimestamp should be set as expected, sell using Balancer", async () => {
          const currentDaiAmount = await setup.dai.balanceOf(subjectCKToken.address);
          const currentWethAmount = await setup.weth.balanceOf(subjectCKToken.address);
          const totalSupply = await subjectCKToken.totalSupply();

          await subject();

          const lastBlockTimestamp = await getLastBlockTimestamp();

          const expectedWethPositionUnits = preciseDiv(currentWethAmount.add(expectedOut), totalSupply);
          const expectedDaiPositionUnits = preciseDiv(currentDaiAmount.sub(ether(1000)), totalSupply);

          const wethPositionUnits = await subjectCKToken.getDefaultPositionRealUnit(setup.weth.address);
          const daiPositionUnits = await subjectCKToken.getDefaultPositionRealUnit(setup.dai.address);

          const lastTrade = (await indexModule.executionInfo(subjectCKToken.address, setup.dai.address)).lastTradeTimestamp;

          expect(wethPositionUnits).to.eq(expectedWethPositionUnits);
          expect(daiPositionUnits).to.eq(expectedDaiPositionUnits);
          expect(lastTrade).to.eq(lastBlockTimestamp);
        });

        it("emits the correct TradeExecuted event", async () => {
          await expect(subject()).to.emit(indexModule, "TradeExecuted").withArgs(
            subjectCKToken.address,
            setup.dai.address,
            setup.weth.address,
            balancerExchangeAdapter.address,
            trader.address,
            ether(1000),
            expectedOut,
            ZERO
          );
        });

        describe("when there is a protcol fee charged", async () => {
          let feePercentage: BigNumber;

          beforeEach(async () => {
            feePercentage = ether(0.005);
            setup.controller = setup.controller.connect(owner.wallet);
            await setup.controller.addFee(
              indexModule.address,
              ZERO, // Fee type on trade function denoted as 0
              feePercentage // Set fee to 5 bps
            );
          });

          it("the position units and lastTradeTimestamp should be set as expected, sell using Balancer", async () => {
            const currentDaiAmount = await setup.dai.balanceOf(subjectCKToken.address);
            const currentWethAmount = await setup.weth.balanceOf(subjectCKToken.address);
            const totalSupply = await subjectCKToken.totalSupply();

            await subject();

            const lastBlockTimestamp = await getLastBlockTimestamp();

            const protocolFee = expectedOut.mul(feePercentage).div(ether(1));
            const expectedWethPositionUnits = preciseDiv(currentWethAmount.add(expectedOut).sub(protocolFee), totalSupply);
            const expectedDaiPositionUnits = preciseDiv(currentDaiAmount.sub(ether(1000)), totalSupply);

            const wethPositionUnits = await subjectCKToken.getDefaultPositionRealUnit(setup.weth.address);
            const daiPositionUnits = await subjectCKToken.getDefaultPositionRealUnit(setup.dai.address);

            const lastTrade = (await indexModule.executionInfo(subjectCKToken.address, setup.dai.address)).lastTradeTimestamp;

            expect(wethPositionUnits).to.eq(expectedWethPositionUnits);
            expect(daiPositionUnits).to.eq(expectedDaiPositionUnits);
            expect(lastTrade).to.eq(lastBlockTimestamp);
          });

          it("the fees should be received by the fee recipient", async () => {
            const feeRecipient = await setup.controller.feeRecipient();
            const beforeWethBalance = await setup.weth.balanceOf(feeRecipient);

            await subject();

            const wethBalance = await setup.weth.balanceOf(feeRecipient);

            const protocolFee = expectedOut.mul(feePercentage).div(ether(1));
            const expectedWethBalance = beforeWethBalance.add(protocolFee);

            expect(wethBalance).to.eq(expectedWethBalance);
          });

          it("emits the correct TradeExecuted event", async () => {
            const protocolFee = expectedOut.mul(feePercentage).div(ether(1));
            await expect(subject()).to.emit(indexModule, "TradeExecuted").withArgs(
              subjectCKToken.address,
              setup.dai.address,
              setup.weth.address,
              balancerExchangeAdapter.address,
              trader.address,
              ether(1000),
              expectedOut.sub(protocolFee),
              protocolFee
            );
          });

          describe("and the buy component does not meet the max trade size", async () => {
            beforeEach(async () => {
              await indexModule.startRebalance(
                subjectCKToken.address,
                [],
                [],
                [ether("60.869565780223716593"), bitcoin(.016), ether(50)],
                await index.positionMultiplier()
              );

              await subject();

              subjectComponent = setup.wbtc.address;
              subjectEthQuantityLimit = MAX_UINT_256;
            });

            it("position units should match the target", async () => {
              const totalSupply = await subjectCKToken.totalSupply();
              const currentWbtcUnit = await subjectCKToken.getDefaultPositionRealUnit(setup.wbtc.address);
              const expectedWbtcSize = preciseDiv(
                preciseMulCeil(bitcoin(.016), totalSupply).sub(preciseMul(currentWbtcUnit, totalSupply)),
                PRECISE_UNIT.sub(feePercentage)
              );

              const [expectedIn, expectedOut] = await sushiswapSetup.router.getAmountsIn(
                expectedWbtcSize,
                [setup.weth.address, setup.wbtc.address]
              );
              const currentWbtcAmount = await setup.wbtc.balanceOf(subjectCKToken.address);
              const currentWethAmount = await setup.weth.balanceOf(subjectCKToken.address);

              const wethUnit = await subjectCKToken.getDefaultPositionRealUnit(setup.weth.address);
              const wbtcUnit = await subjectCKToken.getDefaultPositionRealUnit(setup.wbtc.address);

              await subject();

              const wbtcExcess = currentWbtcAmount.sub(preciseMul(totalSupply, wbtcUnit));
              const wethExcess = currentWethAmount.sub(preciseMul(totalSupply, wethUnit));

              const expectedWethPositionUnits = preciseDiv(currentWethAmount.sub(expectedIn).sub(wethExcess), totalSupply);
              const expectedWbtcPositionUnits = preciseDiv(
                currentWbtcAmount.add(preciseMulCeil(expectedOut, PRECISE_UNIT.sub(feePercentage))).sub(wbtcExcess),
                totalSupply
              );

              const wethPositionUnits = await subjectCKToken.getDefaultPositionRealUnit(setup.weth.address);
              const wbtcPositionUnits = await subjectCKToken.getDefaultPositionRealUnit(setup.wbtc.address);

              expect(wbtcPositionUnits).to.eq(expectedWbtcPositionUnits);
              expect(wethPositionUnits).to.eq(expectedWethPositionUnits);
            });
          });
        });

        describe("when the component being sold doesn't meet the max trade size", async () => {
          beforeEach(async () => {
            subjectComponent = uniswapSetup.uni.address;
            subjectEthQuantityLimit = ZERO;
          });

          it("the trade gets rounded down to meet the target", async () => {
            const totalSupply = await subjectCKToken.totalSupply();
            const currentUniUnit = await subjectCKToken.getDefaultPositionRealUnit(uniswapSetup.uni.address);
            const expectedUniSize = preciseMul(currentUniUnit.sub(ether("60.869565780223716593")), totalSupply);

            const [expectedIn, expectedOut] = await uniswapSetup.router.getAmountsOut(
              expectedUniSize,
              [uniswapSetup.uni.address, setup.weth.address]
            );

            const currentUniAmount = await uniswapSetup.uni.balanceOf(subjectCKToken.address);
            const currentWethAmount = await setup.weth.balanceOf(subjectCKToken.address);

            await subject();

            const lastBlockTimestamp = await getLastBlockTimestamp();

            const expectedWethPositionUnits = preciseDiv(currentWethAmount.add(expectedOut), totalSupply);
            const expectedUniPositionUnits = preciseDiv(currentUniAmount.sub(expectedIn), totalSupply);

            const wethPositionUnits = await subjectCKToken.getDefaultPositionRealUnit(setup.weth.address);
            const uniPositionUnits = await subjectCKToken.getDefaultPositionRealUnit(uniswapSetup.uni.address);
            const lastTrade = (await indexModule.executionInfo(subjectCKToken.address, uniswapSetup.uni.address)).lastTradeTimestamp;

            expect(uniPositionUnits).to.eq(expectedUniPositionUnits);
            expect(wethPositionUnits).to.eq(expectedWethPositionUnits);
            expect(lastTrade).to.eq(lastBlockTimestamp);
          });
        });

        describe("when the component is being bought using Sushiswap", async () => {
          beforeEach(async () => {
            await subject();

            subjectComponent = setup.wbtc.address;
            subjectEthQuantityLimit = MAX_UINT_256;
          });

          it("the position units and lastTradeTimestamp should be set as expected", async () => {0;
            const [expectedIn, expectedOut] = await sushiswapSetup.router.getAmountsIn(
              bitcoin(.1),
              [setup.weth.address, setup.wbtc.address]
            );
            const currentWbtcAmount = await setup.wbtc.balanceOf(subjectCKToken.address);
            const currentWethAmount = await setup.weth.balanceOf(subjectCKToken.address);

            const wethUnit = await subjectCKToken.getDefaultPositionRealUnit(setup.weth.address);
            const wbtcUnit = await subjectCKToken.getDefaultPositionRealUnit(setup.wbtc.address);
            const totalSupply = await subjectCKToken.totalSupply();

            await subject();

            const lastBlockTimestamp = await getLastBlockTimestamp();

            const wbtcExcess = currentWbtcAmount.sub(preciseMul(totalSupply, wbtcUnit));
            const wethExcess = currentWethAmount.sub(preciseMul(totalSupply, wethUnit));

            const expectedWethPositionUnits = preciseDiv(currentWethAmount.sub(expectedIn).sub(wethExcess), totalSupply);
            const expectedWbtcPositionUnits = preciseDiv(currentWbtcAmount.add(expectedOut).sub(wbtcExcess), totalSupply);

            const wethPositionUnits = await subjectCKToken.getDefaultPositionRealUnit(setup.weth.address);
            const wbtcPositionUnits = await subjectCKToken.getDefaultPositionRealUnit(setup.wbtc.address);
            const lastTrade = (await indexModule.executionInfo(subjectCKToken.address, setup.wbtc.address)).lastTradeTimestamp;

            expect(wbtcPositionUnits).to.eq(expectedWbtcPositionUnits);
            expect(wethPositionUnits).to.eq(expectedWethPositionUnits);
            expect(lastTrade).to.eq(lastBlockTimestamp);
          });

          it("emits the correct TradeExecuted event", async () => {
            const [expectedIn, ] = await sushiswapSetup.router.getAmountsIn(
              bitcoin(.1),
              [setup.weth.address, setup.wbtc.address]
            );
            await expect(subject()).to.emit(indexModule, "TradeExecuted").withArgs(
              subjectCKToken.address,
              setup.weth.address,
              setup.wbtc.address,
              sushiswapExchangeAdapter.address,
              trader.address,
              expectedIn,
              bitcoin(.1),
              ZERO
            );
          });
        });

        describe("when exchange doesn't return minimum receive eth amount, while selling component", async () => {
          beforeEach(async () => {
            expectedOut = (await balancerSetup.exchange.viewSplitExactIn(
              setup.dai.address,
              setup.weth.address,
              ether(1000),
              THREE
            )).totalOutput;
            subjectEthQuantityLimit = expectedOut.mul(2);
          });

          it("should revert", async () => {
            await expect(subject()).to.be.reverted;
          });
        });

        describe("when exchange takes more than maximum input eth amount, while buying component", async () => {
          beforeEach(async () => {
            subjectComponent = setup.wbtc.address;
            const [expectedIn, ] = await sushiswapSetup.router.getAmountsOut(
              bitcoin(.1),
              [setup.wbtc.address, setup.weth.address]
            );
            subjectEthQuantityLimit = expectedIn.div(2);
          });

          it("should revert", async () => {
            await expect(subject()).to.be.reverted;
          });
        });

        describe("when anyoneTrade is true and a random address calls", async () => {
          beforeEach(async () => {
            await indexModule.setAnyoneTrade(subjectCKToken.address, true);
            subjectCaller = await getRandomAccount();
          });

          it("the trade should not revert", async () => {
            await expect(subject()).to.not.be.reverted;
          });
        });

        describe("when not enough time has elapsed between trades", async () => {
          beforeEach(async () => {
            await subject();
            subjectIncreaseTime = ZERO;
          });

          it("should revert", async () => {
            await expect(subject()).to.be.revertedWith("Component cool off in progress");
          });
        });

        describe("when exchange adapter has been removed from integration registry", async () => {
          beforeEach(async () => {
            await indexModule.setExchanges(subjectCKToken.address, [subjectComponent], [balancerAdapterName]);
            await setup.integrationRegistry.removeIntegration(indexModule.address, balancerAdapterName);
          });

          afterEach(async () => {
            await setup.integrationRegistry.addIntegration(
              indexModule.address,
              balancerAdapterName,
              balancerExchangeAdapter.address
            );
          });

          it("the trade reverts", async () => {
            await expect(subject()).to.be.revertedWith("Must be valid adapter");
          });
        });

        describe("when the passed component is not included in the rebalance", async () => {
          beforeEach(async () => {
            subjectComponent = sushiswapSetup.uni.address;
          });

          it("should revert", async () => {
            await expect(subject()).to.be.revertedWith("Component not part of rebalance");
          });
        });

        describe("when the calling address is not a permissioned address", async () => {
          beforeEach(async () => {
            subjectCaller = await getRandomAccount();
          });

          it("should revert", async () => {
            await expect(subject()).to.be.revertedWith("Address not permitted to trade");
          });
        });

        describe("when the component is weth", async() => {
          beforeEach(async () => {
            subjectComponent = setup.weth.address;
          });

          it("should revert", async () => {
            expect(subject()).to.be.revertedWith("Can not explicitly trade WETH");
          });
        });

        describe("when there are external positions for a component", async () => {
          beforeEach(async () => {
            await subjectCKToken.connect(positionModule.wallet)
              .addExternalPositionModule(subjectComponent, positionModule.address);
            });

          afterEach(async () => {
            await subjectCKToken.connect(positionModule.wallet)
              .removeExternalPositionModule(subjectComponent, positionModule.address);
            });

          it("should revert", async () => {
            await expect(subject()).to.be.revertedWith("External positions not allowed");
            });
        });

        describe("when caller is a contract", async () => {
          let subjectTarget: Address;
          let subjectCallData: string;
          let subjectValue: BigNumber;

          let contractCaller: ContractCallerMock;

          beforeEach(async () => {
            contractCaller = await deployer.mocks.deployContractCallerMock();
            await indexModule.connect(owner.wallet).setTraderStatus(subjectCKToken.address, [contractCaller.address], [true]);

            subjectTarget = indexModule.address;
            subjectCallData = indexModule.interface.encodeFunctionData("trade", [subjectCKToken.address, subjectComponent, ZERO]);
            subjectValue = ZERO;
          });

          async function subjectContractCaller(): Promise<ContractTransaction> {
            return await contractCaller.invoke(
              subjectTarget,
              subjectValue,
              subjectCallData
            );
          }

          it("should not revert", async () => {
            await expect(subjectContractCaller()).to.not.be.reverted;
          });

          describe("when anyone trade is true", async () => {
            beforeEach(async () => {
              await indexModule.connect(owner.wallet).setAnyoneTrade(subjectCKToken.address, true);
            });

            it("the trader reverts", async () => {
              await expect(subjectContractCaller()).to.be.revertedWith("Caller must be EOA Address");
            });
          });
        });
      });

      describe("with alternative target units", async () => {
        before(async () => {
          oldTargetUnits = [ether(100), ZERO, ether(185)];
        });

        after(async () => {
          oldTargetUnits = [ether(60.869565), bitcoin(.02), ether(50)];
        });

        beforeEach(async () => {
          initializeSubjectVariables();

          expectedOut = (await balancerSetup.exchange.viewSplitExactIn(
            setup.dai.address,
            setup.weth.address,
            ether(1000),
            THREE
          )).totalOutput;
          subjectEthQuantityLimit = expectedOut;
        });
        cacheBeforeEach(startRebalance);

        describe("when the sell happens on Sushiswap", async () => {
          beforeEach(async () => {
            subjectComponent = setup.wbtc.address;
            subjectEthQuantityLimit = ZERO;
          });

          it("the position units and lastTradeTimestamp should be set as expected", async () => {
            const [expectedIn, expectedOut] = await sushiswapSetup.router.getAmountsOut(
              bitcoin(.1),
              [setup.wbtc.address, setup.weth.address]
            );

            const currentWbtcAmount = await setup.wbtc.balanceOf(subjectCKToken.address);
            const currentWethAmount = await setup.weth.balanceOf(subjectCKToken.address);

            const wethUnit = await subjectCKToken.getDefaultPositionRealUnit(setup.weth.address);
            const wbtcUnit = await subjectCKToken.getDefaultPositionRealUnit(setup.wbtc.address);
            const totalSupply = await subjectCKToken.totalSupply();

            await subject();

            const lastBlockTimestamp = await getLastBlockTimestamp();

            const wbtcExcess = currentWbtcAmount.sub(preciseMul(totalSupply, wbtcUnit));
            const wethExcess = currentWethAmount.sub(preciseMul(totalSupply, wethUnit));

            const expectedWethPositionUnits = preciseDiv(currentWethAmount.add(expectedOut).sub(wethExcess), totalSupply);
            const expectedWbtcPositionUnits = preciseDiv(currentWbtcAmount.sub(expectedIn).sub(wbtcExcess), totalSupply);

            const wethPositionUnits = await subjectCKToken.getDefaultPositionRealUnit(setup.weth.address);
            const wbtcPositionUnits = await subjectCKToken.getDefaultPositionRealUnit(setup.wbtc.address);
            const lastTrade = (await indexModule.executionInfo(subjectCKToken.address, setup.wbtc.address)).lastTradeTimestamp;

            expect(wbtcPositionUnits).to.eq(expectedWbtcPositionUnits);
            expect(wethPositionUnits).to.eq(expectedWethPositionUnits);
            expect(lastTrade).to.eq(lastBlockTimestamp);
          });

          describe("sell trade zeroes out the asset", async () => {
            before(async () => {
              oldTargetUnits = [ether(100), ZERO, ether(185)];
            });

            beforeEach(async () => {
              await increaseTimeAsync(ONE_MINUTE_IN_SECONDS.mul(5));
              await indexModule.connect(trader.wallet).trade(subjectCKToken.address, setup.wbtc.address, ZERO);
              await increaseTimeAsync(ONE_MINUTE_IN_SECONDS.mul(5));
              await indexModule.connect(trader.wallet).trade(subjectCKToken.address, setup.wbtc.address, ZERO);
            });

            after(async () => {
              oldTargetUnits = [ether(60.869565), bitcoin(.02), ether(50)];
            });

            it("should remove the asset from the index", async () => {
              await subject();

              const components = await subjectCKToken.getComponents();
              const positionUnit = await subjectCKToken.getDefaultPositionRealUnit(setup.wbtc.address);

              expect(components).to.not.contain(setup.wbtc.address);
              expect(positionUnit).to.eq(ZERO);
            });
          });
        });

        describe("when the buy happens on Balancer", async () => {
          beforeEach(async () => {
            await increaseTimeAsync(ONE_MINUTE_IN_SECONDS.mul(5));
            await indexModule.connect(trader.wallet).trade(subjectCKToken.address, setup.wbtc.address, ZERO);
            await increaseTimeAsync(ONE_MINUTE_IN_SECONDS.mul(5));
            await indexModule.connect(trader.wallet).trade(subjectCKToken.address, setup.wbtc.address, ZERO);

            subjectComponent = setup.dai.address;
            subjectEthQuantityLimit = MAX_UINT_256;
          });

          it("the position units and lastTradeTimestamp should be set as expected", async () => {
            const expectedIn = (await balancerSetup.exchange.viewSplitExactOut(
              setup.weth.address,
              setup.dai.address,
              ether(1000),
              THREE
            )).totalOutput;
            const currentDaiAmount = await setup.dai.balanceOf(subjectCKToken.address);
            const currentWethAmount = await setup.weth.balanceOf(subjectCKToken.address);

            const wethUnit = await subjectCKToken.getDefaultPositionRealUnit(setup.weth.address);
            const daiUnit = await subjectCKToken.getDefaultPositionRealUnit(setup.dai.address);
            const totalSupply = await subjectCKToken.totalSupply();

            await subject();

            const lastBlockTimestamp = await getLastBlockTimestamp();

            const wethPositionUnits = await subjectCKToken.getDefaultPositionRealUnit(setup.weth.address);
            const daiPositionUnits = await subjectCKToken.getDefaultPositionRealUnit(setup.dai.address);
            const lastTrade = (await indexModule.executionInfo(subjectCKToken.address, setup.dai.address)).lastTradeTimestamp;

            const daiExcess = currentDaiAmount.sub(preciseMul(totalSupply, daiUnit));
            const wethExcess = currentWethAmount.sub(preciseMul(totalSupply, wethUnit));
            const expectedWethPositionUnits = preciseDiv(
              currentWethAmount.sub(expectedIn).sub(wethExcess),
              totalSupply
            );
            const expectedDaiPositionUnits = preciseDiv(
              currentDaiAmount.add(ether(1000)).sub(daiExcess),
              totalSupply
            );

            expect(wethPositionUnits).to.eq(expectedWethPositionUnits);
            expect(daiPositionUnits).to.eq(expectedDaiPositionUnits);
            expect(lastTrade).to.eq(lastBlockTimestamp);
          });
        });
      });

      describe("when alternative issue amount", async () => {
        before(async () => {
          issueAmount = ether(20);
        });

        after(async () => {
          issueAmount = ether("20.000000000000000001");
        });

        beforeEach(async () => {
          initializeSubjectVariables();

          expectedOut = (await balancerSetup.exchange.viewSplitExactIn(
            setup.dai.address,
            setup.weth.address,
            ether(1000),
            THREE
          )).totalOutput;
          subjectEthQuantityLimit = expectedOut;
        });
        cacheBeforeEach(startRebalance);

        describe("when fees are accrued and target is met", async () => {
          beforeEach(async () => {
            await increaseTimeAsync(ONE_MINUTE_IN_SECONDS.mul(5));
            await indexModule.connect(trader.wallet).trade(subjectCKToken.address, setup.dai.address, ZERO);

            await setup.streamingFeeModule.accrueFee(subjectCKToken.address);
          });

          it("the trade reverts", async () => {
            const targetUnit = (await indexModule.executionInfo(subjectCKToken.address, setup.dai.address)).targetUnit;
            const currentUnit = await subjectCKToken.getDefaultPositionRealUnit(setup.dai.address);

            expect(targetUnit).to.not.eq(currentUnit);
            await expect(subject()).to.be.revertedWith("Target already met");
          });
        });

        describe("when the target has been met", async () => {

          beforeEach(async () => {
            await increaseTimeAsync(ONE_MINUTE_IN_SECONDS.mul(5));
            await indexModule.connect(trader.wallet).trade(subjectCKToken.address, setup.dai.address, ZERO);
          });

          it("the trade reverts", async () => {
            await expect(subject()).to.be.revertedWith("Target already met");
          });
        });
      });

      describe("when set has weth as component", async () => {
        beforeEach(async () => {
          // current units [ether(86.9565217), bitcoin(.01111111), ether(100), ether(0.434782609), ZERO]
          oldTargetUnits = [ether("60.869565780223716593"), bitcoin(.02), ether(50), ether(0.434782609)];
          issueAmount = ether(20);

          expectedOut = (await balancerSetup.exchange.viewSplitExactIn(
            setup.dai.address,
            setup.weth.address,
            ether(1000),
            THREE
          )).totalOutput;
          subjectEthQuantityLimit = expectedOut;

          initializeSubjectVariables();
          subjectCKToken = indexWithWeth;

          await startRebalance();
        });

        after(async () => {
          // current units [ether(86.9565217), bitcoin(.01111111), ether(100), ZERO]
          oldTargetUnits = [ether("60.869565780223716593"), bitcoin(.02), ether(50)];
          issueAmount = ether("20.000000000000000001");
        });

        it("the position units and lastTradeTimestamp should be set as expected, sell using Balancer", async () => {
          const currentDaiAmount = await setup.dai.balanceOf(subjectCKToken.address);
          const currentWethAmount = await setup.weth.balanceOf(subjectCKToken.address);
          const totalSupply = await subjectCKToken.totalSupply();

          await subject();

          const lastBlockTimestamp = await getLastBlockTimestamp();

          const expectedWethPositionUnits = preciseDiv(currentWethAmount.add(expectedOut), totalSupply);
          const expectedDaiPositionUnits = preciseDiv(currentDaiAmount.sub(ether(1000)), totalSupply);

          const wethPositionUnits = await subjectCKToken.getDefaultPositionRealUnit(setup.weth.address);
          const daiPositionUnits = await subjectCKToken.getDefaultPositionRealUnit(setup.dai.address);

          const lastTrade = (await indexModule.executionInfo(subjectCKToken.address, setup.dai.address)).lastTradeTimestamp;

          expect(wethPositionUnits).to.eq(expectedWethPositionUnits);
          expect(daiPositionUnits).to.eq(expectedDaiPositionUnits);
          expect(lastTrade).to.eq(lastBlockTimestamp);
        });
      });

      describe("when adding a new asset", async () => {
        before(async () => {
          oldTargetUnits = [ether(100), ZERO, ether(185)];
          newComponents = [sushiswapSetup.uni.address];
          newTargetUnits = [ether(50)];
        });

        beforeEach(async () => {
          await setup.weth.connect(owner.wallet).approve(sushiswapSetup.router.address, ether(1000));
          await sushiswapSetup.uni.connect(owner.wallet).approve(sushiswapSetup.router.address, ether(200000));
          await sushiswapSetup.router.connect(owner.wallet).addLiquidity(
            setup.weth.address,
            sushiswapSetup.uni.address,
            ether(1000),
            ether(200000),
            ether(800),
            ether(100000),
            owner.address,
            MAX_UINT_256
          );

          initializeSubjectVariables();
          subjectComponent = sushiswapSetup.uni.address;
          subjectEthQuantityLimit = MAX_UINT_256;

          await startRebalance();

          await increaseTimeAsync(ONE_MINUTE_IN_SECONDS.mul(5));
          await indexModule.connect(trader.wallet).trade(subjectCKToken.address, setup.wbtc.address, ZERO);
        });

        after(async () => {
          oldTargetUnits = [ether(60.869565), bitcoin(.02), ether(50)];
          newComponents = [];
          newTargetUnits = [];
        });

        it("the position units and lastTradeTimestamp should be set as expected", async () => {
          await subject();

          const lastBlockTimestamp = await getLastBlockTimestamp();
          const totalSupply = await subjectCKToken.totalSupply();
          const components = await subjectCKToken.getComponents();
          const expectedSushiPositionUnits = preciseDiv(ether(500), totalSupply);

          const sushiPositionUnits = await subjectCKToken.getDefaultPositionRealUnit(sushiswapSetup.uni.address);
          const lastTrade = (await indexModule.executionInfo(subjectCKToken.address, sushiswapSetup.uni.address)).lastTradeTimestamp;

          expect(components).to.contain(sushiswapSetup.uni.address);
          expect(sushiPositionUnits).to.eq(expectedSushiPositionUnits);
          expect(lastTrade).to.eq(lastBlockTimestamp);
        });
      });
    });

    describe("#tradeRemainingWETH", async () => {
      let subjectComponent: Address;
      let subjectIncreaseTime: BigNumber;
      let subjectMinComponentReceived: BigNumber;

      before(async () => {
        // current units [ether(86.9565217), bitcoin(.01111111), ether(100)]
        oldTargetUnits = [ether(60.869565), bitcoin(.02), ether(50)];
      });

      const startRebalanceAndTrade = async () => {
        // oldTargetUnits = [ether(60.869565), bitcoin(.02), ether(50)];
        await setup.approveAndIssueCKToken(subjectCKToken, ether(20));
        await indexModule.startRebalance(subjectCKToken.address, [], [], oldTargetUnits, await subjectCKToken.positionMultiplier());

        await increaseTimeAsync(ONE_MINUTE_IN_SECONDS.mul(5));
        await indexModule.connect(trader.wallet).trade(subjectCKToken.address, setup.dai.address, ZERO);
        await indexModule.connect(trader.wallet).trade(subjectCKToken.address, uniswapSetup.uni.address, ZERO);
        await indexModule.connect(trader.wallet).trade(subjectCKToken.address, setup.wbtc.address, MAX_UINT_256);
      };

      const getFixedAmountIn = async (ckToken: CKToken, component: Address, considerMaxSize: boolean = false) => {
        const totalSupply = await ckToken.totalSupply();
        const componentMaxSize = considerMaxSize ? (await indexModule.executionInfo(ckToken.address, component)).maxSize : MAX_UINT_256;
        const currentPositionMultiplier = await ckToken.positionMultiplier();
        const positionMultiplier = (await indexModule.rebalanceInfo(ckToken.address)).positionMultiplier;

        const currentUnit = await ckToken.getDefaultPositionRealUnit(component);
        const targetUnit = (await indexModule.executionInfo(ckToken.address, component)).targetUnit;
        const normalizedTargetUnit = targetUnit.mul(currentPositionMultiplier).div(positionMultiplier);

        const currentNotional = preciseMul(totalSupply, currentUnit);
        const targetNotional = preciseMulCeil(totalSupply, normalizedTargetUnit);

        if (targetNotional.lt(currentNotional)) {
          return componentMaxSize.lt(currentNotional.sub(targetNotional)) ? componentMaxSize : currentNotional.sub(targetNotional);
        } else {
          return componentMaxSize.lt(targetNotional.sub(currentNotional)) ? componentMaxSize : targetNotional.sub(currentNotional);
        }
      };

      const initializeSubjectVariables = () => {
        subjectCaller = trader;
        subjectCKToken = index;
        subjectComponent = setup.wbtc.address;
        subjectIncreaseTime = ONE_MINUTE_IN_SECONDS.mul(5);
        subjectMinComponentReceived = ZERO;
      };

      async function subject(): Promise<ContractTransaction> {
        await increaseTimeAsync(subjectIncreaseTime);
        return await indexModule.connect(subjectCaller.wallet).tradeRemainingWETH(
          subjectCKToken.address,
          subjectComponent,
          subjectMinComponentReceived
        );
      }

      describe("with default target units", () => {
        let wethAmountIn: BigNumber;
        let expectedWbtcOut: BigNumber;

        beforeEach(initializeSubjectVariables);
        cacheBeforeEach(startRebalanceAndTrade);

        describe("when ETH remaining in contract, trade remaining WETH", async () => {
          beforeEach(async () => {
            wethAmountIn = await getFixedAmountIn(subjectCKToken, setup.weth.address);
            [, expectedWbtcOut] = await sushiswapSetup.router.getAmountsOut(
              wethAmountIn,
              [setup.weth.address, setup.wbtc.address]
            );

            subjectMinComponentReceived = expectedWbtcOut;
          });

          it("the position units and lastTradeTimestamp should be set as expected", async () => {
            const totalSupply = await subjectCKToken.totalSupply();
            const currentWbtcAmount = await setup.wbtc.balanceOf(subjectCKToken.address);

            await subject();

            const lastBlockTimestamp = await getLastBlockTimestamp();

            const expectedWbtcPositionUnits = preciseDiv(currentWbtcAmount.add(expectedWbtcOut), totalSupply);

            const wethPositionUnits = await subjectCKToken.getDefaultPositionRealUnit(setup.weth.address);
            const wbtcPositionUnits = await subjectCKToken.getDefaultPositionRealUnit(setup.wbtc.address);
            const lastTrade = (await indexModule.executionInfo(subjectCKToken.address, subjectComponent)).lastTradeTimestamp;

            expect(wethPositionUnits).to.eq(ZERO);
            expect(wbtcPositionUnits).to.eq(expectedWbtcPositionUnits);
            expect(lastTrade).to.eq(lastBlockTimestamp);
          });

          it("emits the correct TradeExecuted event", async () => {
            await expect(subject()).to.be.emit(indexModule, "TradeExecuted").withArgs(
              subjectCKToken.address,
              setup.weth.address,
              subjectComponent,
              sushiswapExchangeAdapter.address,
              subjectCaller.wallet.address,
              wethAmountIn,
              expectedWbtcOut,
              ZERO,
            );
          });

          describe("when protocol fees is charged", async () => {
            let subjectFeePercentage: BigNumber;

            beforeEach(async () => {
              subjectFeePercentage = ether(0.05);
              setup.controller = setup.controller.connect(owner.wallet);
              await setup.controller.addFee(
                indexModule.address,
                ZERO, // Fee type on trade function denoted as 0
                subjectFeePercentage, // Set fee to 5 bps
              );
            });

            it("the position units and lastTradeTimestamp should be set as expected", async () => {
              const totalSupply = await subjectCKToken.totalSupply();
              const currentWbtcAmount = await setup.wbtc.balanceOf(subjectCKToken.address);

              await subject();

              const lastBlockTimestamp = await getLastBlockTimestamp();

              const protocolFee = expectedWbtcOut.mul(subjectFeePercentage).div(ether(1));
              const expectedWbtcPositionUnits = preciseDiv(currentWbtcAmount.add(expectedWbtcOut).sub(protocolFee), totalSupply);

              const wethPositionUnits = await subjectCKToken.getDefaultPositionRealUnit(setup.weth.address);
              const wbtcPositionUnits = await subjectCKToken.getDefaultPositionRealUnit(setup.wbtc.address);
              const lastTrade = (await indexModule.executionInfo(subjectCKToken.address, subjectComponent)).lastTradeTimestamp;

              expect(wethPositionUnits).to.eq(ZERO);
              expect(wbtcPositionUnits).to.eq(expectedWbtcPositionUnits);
              expect(lastTrade).to.eq(lastBlockTimestamp);
            });

            it("the fees should be received by the fee recipient", async () => {
              const feeRecipient = await setup.controller.feeRecipient();
              const beforeWbtcBalance = await setup.wbtc.balanceOf(feeRecipient);

              await subject();

              const wbtcBalance = await setup.wbtc.balanceOf(feeRecipient);

              const protocolFee = expectedWbtcOut.mul(subjectFeePercentage).div(ether(1));
              const expectedWbtcBalance = beforeWbtcBalance.add(protocolFee);

              expect(wbtcBalance).to.eq(expectedWbtcBalance);
            });

            it("emits the correct TradeExecuted event", async () => {
              const protocolFee = expectedWbtcOut.mul(subjectFeePercentage).div(ether(1));
              await expect(subject()).to.be.emit(indexModule, "TradeExecuted").withArgs(
                subjectCKToken.address,
                setup.weth.address,
                subjectComponent,
                sushiswapExchangeAdapter.address,
                subjectCaller.wallet.address,
                wethAmountIn,
                expectedWbtcOut.sub(protocolFee),
                protocolFee,
              );
            });

            describe("when the prototol fee percentage is 100", async () => {
              beforeEach(async () => {
                subjectFeePercentage = ether(100);
                await setup.controller.editFee(
                  indexModule.address,
                  ZERO, // Fee type on trade function denoted as 0
                  subjectFeePercentage,
                );
              });

              it("should revert", async () => {
                await expect(subject()).to.be.revertedWith("transfer amount exceeds balance");
              });
            });

            describe("when the prototol fee percentage is MAX_UINT_256", async () => {
              beforeEach(async () => {
                subjectFeePercentage = ether(100);
                await setup.controller.editFee(
                  indexModule.address,
                  ZERO, // Fee type on trade function denoted as 0
                  subjectFeePercentage,
                );
              });

              it("should revert", async () => {
                await expect(subject()).to.be.revertedWith("transfer amount exceeds balance");
              });
            });
          });


          describe("when exchange returns amount less than subjectMinComponentReceived", async () => {
            beforeEach(async () => {
              [, expectedWbtcOut] = await sushiswapSetup.router.getAmountsOut(
                wethAmountIn,
                [setup.weth.address, setup.wbtc.address]
              );
              subjectMinComponentReceived = expectedWbtcOut.mul(2);
            });

            it("should revert", async () => {
              await expect(subject()).to.be.reverted;
            });
          });

          describe("when the target has been met and trading overshoots target unit", async () => {
            beforeEach(async () => {
              subjectComponent = setup.dai.address;
              subjectMinComponentReceived = ZERO;
            });

            it("the trade reverts", async () => {
              await expect(subject()).to.be.revertedWith("Can not exceed target unit");
            });
          });

          describe("when not enough time has elapsed between trades", async () => {
            beforeEach(async () => {
              subjectIncreaseTime = ZERO;
            });

            it("should revert", async () => {
              await expect(subject()).to.be.revertedWith("Component cool off in progress");
            });
          });

          describe("when the passed component is not included in rebalance components", async () => {
            beforeEach(async () => {
              subjectComponent = sushiswapSetup.uni.address;
              subjectMinComponentReceived = ZERO;
            });

            it("should revert", async () => {
              await expect(subject()).to.be.revertedWith("Component not part of rebalance");
            });
          });

          describe("when there are external positions for a component", async () => {
            beforeEach(async () => {
              await subjectCKToken
                .connect(positionModule.wallet)
                .addExternalPositionModule(subjectComponent, positionModule.address);
            });

            afterEach(async () => {
              await subjectCKToken
                .connect(positionModule.wallet)
                .removeExternalPositionModule(subjectComponent, positionModule.address);
            });

            it("should revert", async () => {
              await expect(subject()).to.be.revertedWith("External positions not allowed");
            });
          });

          describe("when the calling address is not a permissioned address", async () => {
            beforeEach(async () => {
              subjectCaller = await getRandomAccount();
            });

            it("should revert", async () => {
              await expect(subject()).to.be.revertedWith("Address not permitted to trade");
            });
          });

          describe("when caller is a contract", async () => {
            let subjectTarget: Address;
            let subjectCallData: string;
            let subjectValue: BigNumber;

            let contractCaller: ContractCallerMock;

            beforeEach(async () => {
              contractCaller = await deployer.mocks.deployContractCallerMock();
              await indexModule.connect(owner.wallet).setTraderStatus(subjectCKToken.address, [contractCaller.address], [true]);

              subjectTarget = indexModule.address;
              subjectIncreaseTime = ONE_MINUTE_IN_SECONDS.mul(5);
              subjectCallData = indexModule.interface.encodeFunctionData(
                "tradeRemainingWETH",
                [subjectCKToken.address, subjectComponent, subjectMinComponentReceived]
              );
              subjectValue = ZERO;
            });

            async function subjectContractCaller(): Promise<ContractTransaction> {
              await increaseTimeAsync(subjectIncreaseTime);
              return await contractCaller.invoke(
                subjectTarget,
                subjectValue,
                subjectCallData
              );
            }

            it("the trade reverts", async () => {
              await expect(subjectContractCaller()).to.not.be.reverted;
            });
          });
        });
      });

      describe("with alternative target units", () => {
        describe("when the value of WETH in index exceeds component trade size", async () => {
          beforeEach(async () => {
            oldTargetUnits = [ether(60.869565), bitcoin(.019), ether(50)];

            initializeSubjectVariables();

            await startRebalanceAndTrade();
            await indexModule.connect(owner.wallet).setTradeMaximums(subjectCKToken.address, [subjectComponent], [bitcoin(.01)]);
          });

          after(async () => {
            await indexModule.connect(owner.wallet).setTradeMaximums(
              subjectCKToken.address,
              [subjectComponent],
              [bitcoin(.1)]
            );
          });

          it("the trade reverts", async () => {
            await expect(subject()).to.be.revertedWith("Trade amount > max trade size");
          });
        });

        describe("when sellable components still remain", async () => {
          beforeEach(async () => {
            oldTargetUnits = [ether(60.869565), bitcoin(.019), ether(48)];
            initializeSubjectVariables();

            await startRebalanceAndTrade();
          });

          it("the trade reverts", async () => {
            await expect(subject()).to.be.revertedWith("Sell other ck components first");
          });
        });
      });

      describe("when set has weth as component", async () => {
        before(async () => {
          oldTargetUnits = [ether(60.869565), bitcoin(.02), ether(50), ether(.434782609)];
        });

        beforeEach(async () => {
          initializeSubjectVariables();
          subjectCKToken = indexWithWeth;

          await startRebalanceAndTrade();
        });

        it("the position units and lastTradeTimestamp should be set as expected", async () => {
          const wethAmountIn = await getFixedAmountIn(subjectCKToken, setup.weth.address);
          const [, expectedWbtcOut] = await sushiswapSetup.router.getAmountsOut(
            wethAmountIn,
            [setup.weth.address, setup.wbtc.address]
          );
          const totalSupply = await subjectCKToken.totalSupply();
          const currentWbtcAmount = await setup.wbtc.balanceOf(subjectCKToken.address);

          await subject();

          const lastBlockTimestamp = await getLastBlockTimestamp();

          const expectedWbtcPositionUnits = preciseDiv(currentWbtcAmount.add(expectedWbtcOut), totalSupply);

          const wethPositionUnits = await subjectCKToken.getDefaultPositionRealUnit(setup.weth.address);
          const wbtcPositionUnits = await subjectCKToken.getDefaultPositionRealUnit(setup.wbtc.address);
          const lastTrade = (await indexModule.executionInfo(subjectCKToken.address, subjectComponent)).lastTradeTimestamp;

          expect(wethPositionUnits).to.eq(ether(.434782609));
          expect(wbtcPositionUnits).to.eq(expectedWbtcPositionUnits);
          expect(lastTrade).to.eq(lastBlockTimestamp);
        });

        describe("when weth is below target unit", async () => {
          before(async () => {
            oldTargetUnits = [ether(60.869565), bitcoin(.02), ether(50), ether(.8)];
          });

          it("the trade reverts", async () => {
            await expect(subject()).to.be.revertedWith("WETH is below target unit");
          });
        });
      });
    });

    describe("#getRebalanceComponents", async () => {
      before(async () => {
        // current units [ether(86.9565217), bitcoin(.01111111), ether(100), ZERO]
        newComponents = [];
        oldTargetUnits = [ether("60.869565780223716593"), bitcoin(.02), ether(55)];
        newTargetUnits = [];
        issueAmount = ether("20.000000000000000001");
      });

      const startRebalance = async () => {
        await setup.approveAndIssueCKToken(subjectCKToken, issueAmount);
        await indexModule.startRebalance(
          subjectCKToken.address,
          newComponents,
          newTargetUnits,
          oldTargetUnits,
          await index.positionMultiplier()
        );
      };

      const initializeSubjectVariables = () => {
        subjectCKToken = index;
      };

      beforeEach(async () => {
        initializeSubjectVariables();
        await startRebalance();
      });

      async function subject(tokenAddress: Address): Promise<any> {
        return await indexModule.getRebalanceComponents(tokenAddress);
      }

      it("the components being rebalanced should be returned", async () => {
        const expectedComponents = [uniswapSetup.uni.address, setup.wbtc.address, setup.dai.address];

        const rebalanceComponents = await subject(subjectCKToken.address);

        expect(rebalanceComponents).to.deep.eq(expectedComponents);
      });

      describe("when ck token is not valid", async () => {
        it("should revert", async () => {
          await expect(subject(ADDRESS_ZERO)).to.be.revertedWith("Must be a valid and initialized CKToken");
        });
      });
    });

    describe("#getComponentTradeQuantityAndDirection", async () => {
      let subjectComponent: Address;

      let feePercentage: BigNumber;

      before(async () => {
        // current units [ether(86.9565217), bitcoin(.01111111), ether(100), ZERO]
        newComponents = [];
        oldTargetUnits = [ether("60.869565780223716593"), bitcoin(.02), ether(55)];
        newTargetUnits = [];
        issueAmount = ether("20.000000000000000001");
      });

      const startRebalance = async () => {
        await setup.approveAndIssueCKToken(subjectCKToken, issueAmount);
        await indexModule.startRebalance(
          subjectCKToken.address,
          newComponents,
          newTargetUnits,
          oldTargetUnits,
          await index.positionMultiplier()
        );
      };

      const initializeSubjectVariables = () => {
        subjectCKToken = index;
        subjectComponent = setup.dai.address;
      };

      beforeEach(async () => {
        initializeSubjectVariables();

        await startRebalance();

        feePercentage = ether(0.005);
        setup.controller = setup.controller.connect(owner.wallet);
        await setup.controller.addFee(
          indexModule.address,
          ZERO, // Fee type on trade function denoted as 0
          feePercentage // Set fee to 5 bps
        );
      });

      async function subject(): Promise<any> {
        return await indexModule.getComponentTradeQuantityAndDirection(
          subjectCKToken.address,
          subjectComponent
        );
      }

      it("the position units and lastTradeTimestamp should be set as expected, sell using Balancer", async () => {
        const totalSupply = await subjectCKToken.totalSupply();
        const currentDaiUnit = await subjectCKToken.getDefaultPositionRealUnit(setup.dai.address);
        const expectedDaiSize = preciseMul(currentDaiUnit, totalSupply).sub(preciseMul(ether(55), totalSupply));

        const [
          isSendTokenFixed,
          componentQuantity,
        ] = await subject();

        expect(componentQuantity).to.eq(expectedDaiSize);
        expect(isSendTokenFixed).to.be.true;
      });

      describe("and the buy component does not meet the max trade size", async () => {
        beforeEach(async () => {
          await indexModule.startRebalance(
            subjectCKToken.address,
            [],
            [],
            [ether("60.869565780223716593"), bitcoin(.016), ether(50)],
            await index.positionMultiplier()
          );

          subjectComponent = setup.wbtc.address;
        });

        it("the correct trade direction and size should be returned", async () => {
          const totalSupply = await subjectCKToken.totalSupply();
          const currentWbtcUnit = await subjectCKToken.getDefaultPositionRealUnit(setup.wbtc.address);
          const expectedWbtcSize = preciseDiv(
            preciseMulCeil(bitcoin(.016), totalSupply).sub(preciseMul(currentWbtcUnit, totalSupply)),
            PRECISE_UNIT.sub(feePercentage)
          );

          const [
            isSendTokenFixed,
            componentQuantity,
          ] = await subject();

          expect(componentQuantity).to.eq(expectedWbtcSize);
          expect(isSendTokenFixed).to.be.false;
        });
      });

      describe("when the ckToken is not valid", async () => {
        beforeEach(() => {
          subjectCKToken = { address: ADDRESS_ZERO } as CKToken;
        });

        it("should revert", async () => {
          expect(subject()).to.be.revertedWith("Must be a valid and initialized CKToken");
        });
      });

      describe("when the component is not valid", async () => {
        beforeEach(() => {
          subjectComponent = ADDRESS_ZERO;
        });

        it("should revert", async () => {
          expect(subject()).to.be.revertedWith("Component not recognized");
        });
      });
    });

    describe("#getIsAllowedTrader", async () => {
      let subjectTraders: Address[];
      let subjectStatuses: boolean[];

      beforeEach(async () => {
        subjectCaller = owner;
        subjectCKToken = index;
        subjectTraders = [trader.address];
        subjectStatuses = [true];

        return await indexModule.connect(subjectCaller.wallet).setTraderStatus(
          subjectCKToken.address,
          subjectTraders,
          subjectStatuses
        );
      });

      async function subject(): Promise<Boolean> {
        return await indexModule.connect(subjectCaller.wallet).getIsAllowedTrader(
          subjectCKToken.address,
          subjectTraders[0],
        );
      }

      it("returns trader status", async () => {
        await subject();

        const isTrader = await subject();
        expect(isTrader).to.be.true;
      });

      describe("when the ckToken is not valid", async () => {
        beforeEach(() => {
          subjectCKToken = { address: ADDRESS_ZERO } as CKToken;
        });

        it("should revert", async () => {
          expect(subject()).to.be.revertedWith("Must be a valid and initialized CKToken");
        });
      });
    });

    describe("#getAllowedTraders", async () => {
      let subjectTraders: Address[];
      let subjectStatuses: boolean[];

      beforeEach(async () => {
        subjectCaller = owner;
        subjectCKToken = index;
        subjectTraders = [trader.address];
        subjectStatuses = [true];

        return await indexModule.connect(subjectCaller.wallet).setTraderStatus(
          subjectCKToken.address,
          subjectTraders,
          subjectStatuses
        );
      });

      async function subject(): Promise<Address[]> {
        return await indexModule.connect(subjectCaller.wallet).getAllowedTraders(subjectCKToken.address);
      }

      it("returns trader status", async () => {
        await subject();

        const expectedTraders = await subject();
        expect(expectedTraders).to.deep.equal(subjectTraders);
      });

      describe("when the ckToken is not valid", async () => {
        beforeEach(() => {
          subjectCKToken = { address: ADDRESS_ZERO } as CKToken;
        });

        it("should revert", async () => {
          expect(subject()).to.be.revertedWith("Must be a valid and initialized CKToken");
        });
      });
    });

    describe("#setRaiseTargetPercentage", async () => {
      let subjectRaiseTargetPercentage: BigNumber;

      beforeEach(async () => {
        subjectCKToken = index;
        subjectCaller = owner;
        subjectRaiseTargetPercentage = ether("0.02");
      });

      async function subject(): Promise<ContractTransaction> {
        return await indexModule.connect(subjectCaller.wallet).setRaiseTargetPercentage(
          subjectCKToken.address,
          subjectRaiseTargetPercentage
        );
      }

      it("sets raiseTargetPercentage", async () => {
        await subject();
        const newRaiseTargetPercentage = (await indexModule.rebalanceInfo(subjectCKToken.address)).raiseTargetPercentage;

        expect(newRaiseTargetPercentage).to.eq(subjectRaiseTargetPercentage);
      });

      it("emits correct RaiseTargetPercentageUpdated event", async () => {
        await expect(subject()).to.emit(indexModule, "RaiseTargetPercentageUpdated").withArgs(
          subjectCKToken.address,
          subjectRaiseTargetPercentage
        );
      });

      describe("when target percentage is 0", async () => {
        beforeEach(async () => {
          subjectRaiseTargetPercentage = ZERO;
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Target percentage must be > 0");
        });
      });
    });

    describe("#raiseAssetTargets", async () => {
      let subjectRaiseTargetPercentage: BigNumber;

      before(async () => {
        // current units [ether(86.9565217), bitcoin(.01111111), ether(100)]
        oldTargetUnits = [ether(60.869565), bitcoin(.015), ether(50)];
      });

      const startRebalance = async (trade: boolean = true, accrueFee: boolean = false) => {
        await setup.approveAndIssueCKToken(subjectCKToken, ether(20));

        if (accrueFee) {
          await increaseTimeAsync(ONE_DAY_IN_SECONDS);
          await setup.streamingFeeModule.accrueFee(subjectCKToken.address);
        }

        await indexModule.startRebalance(subjectCKToken.address, [], [], oldTargetUnits, await subjectCKToken.positionMultiplier());

        if (trade) {
          await increaseTimeAsync(ONE_MINUTE_IN_SECONDS.mul(5));
          await indexModule.connect(trader.wallet).trade(subjectCKToken.address, setup.dai.address, ZERO);
          await indexModule.connect(trader.wallet).trade(subjectCKToken.address, uniswapSetup.uni.address, ZERO);
          await indexModule.connect(trader.wallet).trade(subjectCKToken.address, setup.wbtc.address, MAX_UINT_256);
        }

        await indexModule.setRaiseTargetPercentage(subjectCKToken.address, subjectRaiseTargetPercentage);
      };

      async function subject(): Promise<ContractTransaction> {
        return await indexModule.connect(subjectCaller.wallet).raiseAssetTargets(subjectCKToken.address);
      }

      const initialializeSubjectVariables = () => {
        subjectCKToken = index;
        subjectCaller = trader;
      };

      describe("with default target units", () => {
        beforeEach(async () => {
          initialializeSubjectVariables();
          subjectRaiseTargetPercentage = ether(0.0025);
          await startRebalance();
        });

        it("the position units and lastTradeTimestamp should be set as expected", async () => {
          const prePositionMultiplier = (await indexModule.rebalanceInfo(subjectCKToken.address)).positionMultiplier;

          await subject();

          const expectedPositionMultiplier = preciseDiv(
            prePositionMultiplier,
            PRECISE_UNIT.add(subjectRaiseTargetPercentage),
          );

          const positionMultiplier = (await indexModule.rebalanceInfo(subjectCKToken.address)).positionMultiplier;

          expect(positionMultiplier).to.eq(expectedPositionMultiplier);
        });

        it("emits correct AssetTargetsRaised event", async () => {
          const prePositionMultiplier = (await indexModule.rebalanceInfo(subjectCKToken.address)).positionMultiplier;

          const expectedPositionMultiplier = preciseDiv(
            prePositionMultiplier,
            PRECISE_UNIT.add(ether(.0025))
          );

          await expect(subject()).to.emit(indexModule, "AssetTargetsRaised").withArgs(
            subjectCKToken.address,
            expectedPositionMultiplier
          );
        });

        describe("when the calling address is not a permissioned address", async () => {
          beforeEach(async () => {
            subjectCaller = await getRandomAccount();
          });

          it("should revert", async () => {
            await expect(subject()).to.be.revertedWith("Address not permitted to trade");
          });
        });
      });

      describe("when the raiseTargetPercentage is the lowest valid decimal (1e-6)", () => {
        beforeEach(async () => {
          initialializeSubjectVariables();
          subjectRaiseTargetPercentage = ether(0.000001);
          await startRebalance();
        });

        afterEach(() => {
          subjectRaiseTargetPercentage = ether(0.0025);
        });

        it("the position multiplier should be set as expected", async () => {
          const prePositionMultiplier = (await indexModule.rebalanceInfo(subjectCKToken.address))
            .positionMultiplier;

          await subject();

          const expectedPositionMultiplier = preciseDiv(
            prePositionMultiplier,
            PRECISE_UNIT.add(subjectRaiseTargetPercentage),
          );

          const positionMultiplier = (await indexModule.rebalanceInfo(subjectCKToken.address))
            .positionMultiplier;
          expect(positionMultiplier).to.eq(expectedPositionMultiplier);
        });
      });

      describe("when the raiseTargetPercentage is MAX_UINT_256", () => {
        beforeEach(async () => {
          initialializeSubjectVariables();
          subjectRaiseTargetPercentage = MAX_UINT_256;
          await startRebalance();
        });

        afterEach(() => {
          subjectRaiseTargetPercentage = ether(0.0025);
        });

        it("it should revert", async () => {
          await expect(subject()).to.be.revertedWith("addition overflow");
        });
      });

      describe("when protocol fees are charged", () => {
        beforeEach(async () => {
          const feePercentage = ether(0.005);
          setup.controller = setup.controller.connect(owner.wallet);
          await setup.controller.addFee(
            indexModule.address,
            ZERO, // Fee type on trade function denoted as 0
            feePercentage // Set fee to 5 bps
          );

          initialializeSubjectVariables();
          await startRebalance(true, true);
        });

        it("the position units and lastTradeTimestamp should be set as expected", async () => {
          const prePositionMultiplier = (await indexModule.rebalanceInfo(subjectCKToken.address)).positionMultiplier;

          await subject();

          const expectedPositionMultiplier = preciseDiv(
            prePositionMultiplier,
            PRECISE_UNIT.add(ether(.0025))
          );

          const positionMultiplier = (await indexModule.rebalanceInfo(subjectCKToken.address)).positionMultiplier;

          expect(positionMultiplier).to.eq(expectedPositionMultiplier);
        });
      });

      describe("when a component is being removed", async () => {
        beforeEach(async () => {
          // current Units [ether(86.9565217), bitcoin(.01111111), ether(100)]
          oldTargetUnits = [ether(60.869565), bitcoin(.015), ZERO];

          initialializeSubjectVariables();

          await indexModule.setTradeMaximums(subjectCKToken.address, [setup.dai.address], [ether(2000)]);
          await startRebalance();
        });

        it("the position units and lastTradeTimestamp should be set as expected and the unit should be zeroed out", async () => {
          const prePositionMultiplier = (await indexModule.rebalanceInfo(subjectCKToken.address)).positionMultiplier;

          await subject();

          const expectedPositionMultiplier = preciseDiv(
            prePositionMultiplier,
            PRECISE_UNIT.add(ether(.0025))
          );

          const positionMultiplier = (await indexModule.rebalanceInfo(subjectCKToken.address)).positionMultiplier;
          const daiUnits = await subjectCKToken.getDefaultPositionRealUnit(setup.dai.address);

          expect(positionMultiplier).to.eq(expectedPositionMultiplier);
          expect(daiUnits).to.eq(ZERO);
        });
      });

      describe("with alternative target units", async () => {
        describe("when the target has been met and no ETH remains", async () => {
          beforeEach(async () => {
            // current Units [ether(86.9565217), bitcoin(.01111111), ether(100)]
            oldTargetUnits = [ether(60.869565), bitcoin(.02), ether(50)];

            initialializeSubjectVariables();
            await startRebalance();

            await increaseTimeAsync(ONE_MINUTE_IN_SECONDS.mul(5));
            await indexModule.connect(trader.wallet).tradeRemainingWETH(subjectCKToken.address, setup.wbtc.address, ZERO);
          });

          it("the trade reverts", async () => {
            await expect(subject()).to.be.revertedWith("Targets not met or ETH =~ 0");
          });
        });

        describe("when ck has weth as a component", async () => {
          describe("when the target has been met and ETH is below target unit", async () => {
            beforeEach(async () => {
              // current Units [ether(86.9565217), bitcoin(.01111111), ether(100), ether(0.434782609)]
              oldTargetUnits = [ether(86.9565217), bitcoin(.01111111), ether(100), ether(0.5)];

              subjectCKToken = indexWithWeth;
              subjectCaller = trader;

              await startRebalance(false);
            });

            it("the trade reverts", async () => {
              await expect(subject()).to.be.revertedWith("Targets not met or ETH =~ 0");
            });
          });
        });
      });
    });

    describe("#setTraderStatus", async () => {
      let subjectTraders: Address[];
      let subjectStatuses: boolean[];

      beforeEach(async () => {
        subjectCaller = owner;
        subjectCKToken = index;
        subjectTraders = [trader.address, await getRandomAddress(), await getRandomAddress()];
        subjectStatuses = [true, true, true];
      });

      async function subject(): Promise<ContractTransaction> {
        return await indexModule.connect(subjectCaller.wallet).setTraderStatus(
          subjectCKToken.address,
          subjectTraders,
          subjectStatuses
        );
      }

      it("the trader status should be flipped to true", async () => {
        await subject();

        const isTraderOne = await indexModule.getIsAllowedTrader(subjectCKToken.address, subjectTraders[0]);
        const isTraderTwo = await indexModule.getIsAllowedTrader(subjectCKToken.address, subjectTraders[1]);
        const isTraderThree = await indexModule.getIsAllowedTrader(subjectCKToken.address, subjectTraders[2]);

        expect(isTraderOne).to.be.true;
        expect(isTraderTwo).to.be.true;
        expect(isTraderThree).to.be.true;
      });

      it("should emit TraderStatusUpdated event", async () => {
        await expect(subject()).to.emit(indexModule, "TraderStatusUpdated").withArgs(
          subjectCKToken.address,
          subjectTraders[0],
          true
        );
      });

      describe("when de-authorizing a trader", async () => {
        beforeEach(async () => {
          await subject();
          subjectStatuses = [false, true, true];
        });

        it("the trader status should be flipped to false", async () => {
          const preConditionTrader = await indexModule.getIsAllowedTrader(subjectCKToken.address, subjectTraders[0]);
          expect(preConditionTrader).to.be.true;

          await subject();

          const postConditionTrader = await indexModule.getIsAllowedTrader(subjectCKToken.address, subjectTraders[0]);
          expect(postConditionTrader).to.be.false;
        });

        it("the tradersHistory should be updated correctly", async() => {
          const preConditionTraders = await indexModule.getAllowedTraders(subjectCKToken.address);
          expect(preConditionTraders).to.deep.equal(subjectTraders);

          await subject();

          const postConditionTraders = await indexModule.getAllowedTraders(subjectCKToken.address);
          const expectedTraders = subjectTraders.slice(1);

          expect(expectedTraders[0]).to.not.equal(expectedTraders[1]);
          expect(postConditionTraders[0]).to.not.equal(postConditionTraders[1]);

          expect(postConditionTraders.includes(expectedTraders[0])).to.be.true;
          expect(postConditionTraders.includes(expectedTraders[1])).to.be.true;
        });
      });

      describe("when array lengths don't match", async () => {
        beforeEach(async () => {
          subjectTraders = [trader.address, await getRandomAddress()];
          subjectStatuses = [false];
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Array length mismatch");
        });
      });

      describe("when traders are duplicated", async () => {
        beforeEach(async () => {
          subjectTraders = [trader.address, trader.address, await getRandomAddress()];
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Cannot duplicate addresses");
        });
      });

      describe("when arrays are empty", async () => {
        beforeEach(async () => {
          subjectTraders = [];
          subjectStatuses = [];
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Array length must be > 0");
        });
      });

      describe("when the caller is not the manager", async () => {
        beforeEach(async () => {
          subjectCaller = await getRandomAccount();
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Must be the CKToken manager");
        });
      });

      describe("when the CKToken has not initialized the module", async () => {
        beforeEach(async () => {
          await setup.controller.removeCK(index.address);
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Must be a valid and initialized CKToken");
        });
      });
    });

    describe("#removeModule", async () => {
      let subjectStatuses: boolean[];
      let subjectTraders: Address[];

      beforeEach(async () => {
        subjectCKToken = index;
        subjectCaller = owner;
        subjectTraders = [trader.address, await getRandomAddress()];
        subjectStatuses = [true, false];
      });

      afterEach(restoreModule);

      async function restoreModule() {
        const isModuleEnabled = await subjectCKToken.isInitializedModule(indexModule.address);

        if (!isModuleEnabled) {
          await subjectCKToken.connect(subjectCaller.wallet).addModule(indexModule.address);
          await indexModule.connect(subjectCaller.wallet).initialize(subjectCKToken.address);
        }
      }

      describe("removal", async () => {
        async function subject(andRestore?: boolean): Promise<any> {
          return subjectCKToken.connect(subjectCaller.wallet).removeModule(indexModule.address);
        }

        it("should remove the module", async () => {
          await subject();
          const isModuleEnabled = await subjectCKToken.isInitializedModule(indexModule.address);
          expect(isModuleEnabled).to.eq(false);
        });
      });

      describe("when restoring module after removal and using permissionInfo", async () => {
        beforeEach(async () => {
          await indexModule.connect(subjectCaller.wallet).setTraderStatus(
            subjectCKToken.address,
            subjectTraders,
            subjectStatuses
          );

          await indexModule.connect(subjectCaller.wallet).setAnyoneTrade(
            subjectCKToken.address,
            true
          );
        });

        async function subject(andRestore?: boolean): Promise<any> {
          await subjectCKToken.connect(subjectCaller.wallet).removeModule(indexModule.address);
          await restoreModule();
        }

        it("should have removed traders from the permissions whitelist", async () => {
          let isTraderOne = await indexModule.getIsAllowedTrader(subjectCKToken.address, subjectTraders[0]);
          expect(isTraderOne).to.be.true;

          await subject();

          isTraderOne = await indexModule.getIsAllowedTrader(subjectCKToken.address, subjectTraders[0]);
          expect(isTraderOne).to.be.false;
        });

        it("should have set anyoneTrade to false", async () => {
          // The public getter return sig generated for permissionInfo's abi
          // is  <bool>anyoneTrade (and nothing else).
          let anyoneTrade = await indexModule.permissionInfo(subjectCKToken.address);
          expect(anyoneTrade).to.be.true;

          await subject();

          anyoneTrade = await indexModule.permissionInfo(subjectCKToken.address);
          expect(anyoneTrade).to.be.false;
        });
      });

      describe("when restoring module after removal and using rebalanceInfo", async () => {
        let subjectNewComponents;
        let subjectNewTargetUnits;
        let subjectOldTargetUnits;
        let subjectPositionMultiplier;

        beforeEach(async () => {
          subjectNewComponents = [sushiswapSetup.uni.address];
          subjectNewTargetUnits = [ether(50)];
          subjectOldTargetUnits = [ether("60.869565780223716593"), bitcoin(.02), ether(50)];
          subjectPositionMultiplier = MAX_UINT_256;

          await indexModule.startRebalance(
            subjectCKToken.address,
            subjectNewComponents,
            subjectNewTargetUnits,
            subjectOldTargetUnits,
            subjectPositionMultiplier
          );

          await indexModule.setRaiseTargetPercentage(subjectCKToken.address, MAX_UINT_256);
        });

        async function subject(andRestore?: boolean): Promise<any> {
          await subjectCKToken.connect(subjectCaller.wallet).removeModule(indexModule.address);
          await restoreModule();
        }

        it("should have cleared the rebalance components array", async () => {
          const preRemoveComponents = await indexModule.getRebalanceComponents(subjectCKToken.address);

          await subject();

          const postRemoveComponents = await indexModule.getRebalanceComponents(subjectCKToken.address);

          expect(preRemoveComponents.length).to.equal(4);
          expect(postRemoveComponents.length).to.equal(ZERO);
        });

        it("should have reset the positionMultiplier to PRECISE_UNIT", async () => {
          const preRemoveMultiplier = (await indexModule.rebalanceInfo(subjectCKToken.address)).positionMultiplier;

          await subject();

          const postRemoveMultiplier = (await indexModule.rebalanceInfo(subjectCKToken.address)).positionMultiplier;
          expect(preRemoveMultiplier).to.equal(MAX_UINT_256);
          expect(postRemoveMultiplier).to.equal(PRECISE_UNIT);
        });

        it("should have zeroed out the raiseTargetPercentage", async () => {
          const preRemoveMultiplier = (await indexModule.rebalanceInfo(subjectCKToken.address)).raiseTargetPercentage;

          await subject();

          const postRemoveMultiplier = (await indexModule.rebalanceInfo(subjectCKToken.address)).raiseTargetPercentage;
          expect(preRemoveMultiplier).to.equal(MAX_UINT_256);
          expect(postRemoveMultiplier).to.equal(ZERO);
        });
      });
    });
  });
});