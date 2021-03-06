import "module-alias/register";
import { BigNumber } from "@ethersproject/bignumber";

import { Address } from "@utils/types";
import { Account } from "@utils/test/types";
import { ADDRESS_ZERO, ZERO } from "@utils/constants";
import { AmmModule, AmmAdapterMock, CKToken, } from "@utils/contracts";
import DeployHelper from "@utils/deploys";
import {
  ether,
  usdc,
} from "@utils/index";
import {
  addSnapshotBeforeRestoreAfterEach,
  getAccounts,
  getRandomAccount,
  getWaffleExpect,
  getSystemFixture,
} from "@utils/test/index";
import { SystemFixture } from "@utils/fixtures";

const expect = getWaffleExpect();

describe("AmmModule", () => {
  let owner: Account;
  let deployer: DeployHelper;
  let setup: SystemFixture;

  let ammModule: AmmModule;
  let ammMock: AmmAdapterMock;

  before(async () => {
    [
      owner,
    ] = await getAccounts();

    deployer = new DeployHelper(owner.wallet);
    setup = getSystemFixture(owner.address);
    await setup.initialize();

    ammModule = await deployer.modules.deployAmmModule(setup.controller.address);
    await setup.controller.addModule(ammModule.address);

    ammMock = await deployer.mocks.deployAmmAdapterMock([setup.dai.address, setup.usdc.address]);
    await setup.integrationRegistry.addIntegration(ammModule.address, "BALANCER", ammMock.address);
  });

  addSnapshotBeforeRestoreAfterEach();

  describe("#constructor", async () => {
    let subjectAmmModule: AmmModule;

    async function subject(): Promise<AmmModule> {
      return deployer.modules.deployAmmModule(setup.controller.address);
    }

    it("should have the correct controller", async () => {
      subjectAmmModule = await subject();
      const expectedController = await subjectAmmModule.controller();
      expect(expectedController).to.eq(setup.controller.address);
    });
  });

  describe("#initialize", async () => {
    let ckToken: CKToken;

    let subjectCKToken: Address;
    let subjectCaller: Account;

    beforeEach(async () => {
      ckToken = await setup.createCKToken([setup.wbtc.address], [ether(1)], [ammModule.address]);
      subjectCKToken = ckToken.address;
      subjectCaller = owner;
    });

    async function subject(): Promise<any> {
      return ammModule.connect(subjectCaller.wallet).initialize(subjectCKToken);
    }

    it("should enable the Module on the CKToken", async () => {
      await subject();
      const isModuleEnabled = await ckToken.isInitializedModule(ammModule.address);
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
          [ammModule.address],
        );

        subjectCKToken = nonEnabledCKToken.address;
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Must be controller-enabled CKToken");
      });
    });
  });

  describe("#removeModule", async () => {
    let ckToken: CKToken;

    let subjectModuleToRemove: Address;
    let subjectCaller: Account;

    beforeEach(async () => {
      ckToken = await setup.createCKToken([setup.wbtc.address], [ether(1)], [ammModule.address]);
      await ammModule.initialize(ckToken.address);

      subjectModuleToRemove = ammModule.address;
      subjectCaller = owner;
    });

    async function subject(): Promise<any> {
      return ckToken.connect(subjectCaller.wallet).removeModule(subjectModuleToRemove);
    }

    it("should successfully remove the module", async () => {
      await subject();
      const isModule = await ckToken.isInitializedModule(ammModule.address);
      expect(isModule).to.eq(false);
    });
  });

  context("Add and Remove Liquidity Tests", async () => {
    let subjectCaller: Account;
    let subjectCKToken: Address;
    let subjectIntegrationName: string;
    let subjectAmmPool: Address;

    let ckToken: CKToken;

    context("when there is a deployed CKToken with enabled AmmModule", async () => {
      before(async () => {
        // Deploy a standard CKToken with the AMM Module
        ckToken = await setup.createCKToken(
          [setup.dai.address, setup.usdc.address],
          [ether(50), usdc(50)],
          [setup.issuanceModule.address, ammModule.address]
        );

        await setup.issuanceModule.initialize(ckToken.address, ADDRESS_ZERO);
        await ammModule.initialize(ckToken.address);

        // Mint some instances of the CKToken
        await setup.approveAndIssueCKToken(ckToken, ether(1));
      });

      describe("#addLiquidity", async () => {
        let subjectComponentsToInput: Address[];
        let subjectMaxComponentQuantities: BigNumber[];
        let subjectMinPoolTokensToMint: BigNumber;

        beforeEach(async () => {
          subjectCKToken = ckToken.address;
          subjectIntegrationName = "BALANCER";
          subjectAmmPool = ammMock.address;
          subjectComponentsToInput = [setup.dai.address, setup.usdc.address];
          subjectMaxComponentQuantities = [ether(50), usdc(50)];
          subjectMinPoolTokensToMint = ether(1);
          subjectCaller = owner;
        });

        async function subject(): Promise<any> {
          return await ammModule.connect(subjectCaller.wallet).addLiquidity(
            subjectCKToken,
            subjectIntegrationName,
            subjectAmmPool,
            subjectMinPoolTokensToMint,
            subjectComponentsToInput,
            subjectMaxComponentQuantities,
          );
        }

        it("should mint the liquidity token to the caller", async () => {
          await subject();
          const liquidityTokenBalance = await ammMock.balanceOf(subjectCKToken);
          expect(liquidityTokenBalance).to.eq(subjectMinPoolTokensToMint);
        });

        it("should update the positions properly", async () => {
          await subject();
          const positions = await ckToken.getPositions();
          expect(positions.length).to.eq(1);
          expect(positions[0].component).to.eq(subjectAmmPool);
          expect(positions[0].unit).to.eq(subjectMinPoolTokensToMint);
        });

        it("should emit the correct events", async () => {
          await expect(subject()).to.emit(ammModule, "LiquidityAdded").withArgs(
            subjectCKToken,
            subjectAmmPool,
            subjectMinPoolTokensToMint,
            subjectComponentsToInput,
            subjectMaxComponentQuantities.map(v => v.mul(-1))
          );
        });

        describe("when liquidity token quantity is 0", async () => {
          beforeEach(async () => {
            subjectMinPoolTokensToMint = ZERO;
          });

          it("should revert", async () => {
            await expect(subject()).to.be.revertedWith("Token quantity must be nonzero");
          });
        });

        describe("when insufficient liquidity tokens are received", async () => {
          beforeEach(async () => {
            await ammMock.setMintLessThanMinimum();
          });

          it("should revert", async () => {
            await expect(subject()).to.be.revertedWith("Liquidity tokens received must be greater than minimum specified");
          });
        });

        describe("when the component units is more than that owned by the CKToken", async () => {
          beforeEach(async () => {
            subjectMaxComponentQuantities = [ether(50), usdc(100)];
          });

          it("should revert", async () => {
            await expect(subject()).to.be.revertedWith("Unit cant be greater than positions owned");
          });
        });

        describe("when the components and units arrays are different lengths", async () => {
          beforeEach(async () => {
            subjectComponentsToInput = [setup.dai.address];
          });

          it("should revert", async () => {
            await expect(subject()).to.be.revertedWith("Components and units must be equal length");
          });
        });

        shouldRevertIfTheCallerIsNotTheManager(subject);
        shouldRevertIfCKTokenIsInvalid(subject);
        shouldRevertIfModuleDisabled(subject);
        shouldRevertIfPoolIsNotSupported(subject);
        shouldRevertIfTheIntegrationIsInvalid(subject);
      });

      describe("#addLiquiditySingleAsset", async () => {
        let subjectComponentToInput: Address;
        let subjectMaxComponentQuantity: BigNumber;
        let subjectMinPoolTokensToMint: BigNumber;

        beforeEach(async () => {
          subjectCKToken = ckToken.address;
          subjectIntegrationName = "BALANCER";
          subjectAmmPool = ammMock.address;
          subjectComponentToInput = setup.dai.address;
          subjectMaxComponentQuantity = ether(50);
          subjectMinPoolTokensToMint = ether(1);
          subjectCaller = owner;
        });

        async function subject(): Promise<any> {
          return await ammModule.connect(subjectCaller.wallet).addLiquiditySingleAsset(
            subjectCKToken,
            subjectIntegrationName,
            subjectAmmPool,
            subjectMinPoolTokensToMint,
            subjectComponentToInput,
            subjectMaxComponentQuantity,
          );
        }

        it("should mint the liquidity token to the caller", async () => {
          await subject();
          const liquidityTokenBalance = await ammMock.balanceOf(subjectCKToken);
          expect(liquidityTokenBalance).to.eq(subjectMinPoolTokensToMint);
        });

        it("should update the positions properly", async () => {
          await subject();
          const positions = await ckToken.getPositions();
          expect(positions.length).to.eq(2);
          expect(positions[0].component).to.eq(setup.usdc.address);
          expect(positions[0].unit).to.eq(usdc(50));
          expect(positions[1].component).to.eq(subjectAmmPool);
          expect(positions[1].unit).to.eq(subjectMinPoolTokensToMint);
        });

        it("should emit the correct events", async () => {
          await expect(subject()).to.emit(ammModule, "LiquidityAdded").withArgs(
            subjectCKToken,
            subjectAmmPool,
            subjectMinPoolTokensToMint,
            [subjectComponentToInput],
            [subjectMaxComponentQuantity.mul(-1)]
          );
        });

        describe("when liquidity token quantity is 0", async () => {
          beforeEach(async () => {
            subjectMinPoolTokensToMint = ZERO;
          });

          it("should revert", async () => {
            await expect(subject()).to.be.revertedWith("Token quantity must be nonzero");
          });
        });

        describe("when insufficient liquidity tokens are received", async () => {
          beforeEach(async () => {
            await ammMock.setMintLessThanMinimum();
          });

          it("should revert", async () => {
            await expect(subject()).to.be.revertedWith("Liquidity tokens received must be greater than minimum specified");
          });
        });

        describe("when the component units is more than that owned by the CKToken", async () => {
          beforeEach(async () => {
            subjectMaxComponentQuantity = ether(100);
          });

          it("should revert", async () => {
            await expect(subject()).to.be.revertedWith("Unit cant be greater than positions owned");
          });
        });

        shouldRevertIfTheCallerIsNotTheManager(subject);
        shouldRevertIfCKTokenIsInvalid(subject);
        shouldRevertIfModuleDisabled(subject);
        shouldRevertIfPoolIsNotSupported(subject);
        shouldRevertIfTheIntegrationIsInvalid(subject);
      });
    });

    context("when there is a deployed CKToken with enabled AmmModule", async () => {
      beforeEach(async () => {
        // Deploy a standard CKToken with the AMM Module
        ckToken = await setup.createCKToken(
          [ammMock.address],
          [ether(1)],
          [setup.issuanceModule.address, ammModule.address]
        );

        await setup.issuanceModule.initialize(ckToken.address, ADDRESS_ZERO);
        await ammModule.initialize(ckToken.address);

        await ammMock.mintTo(owner.address, ether(1));
        await setup.dai.transfer(ammMock.address, ether(50));
        await setup.usdc.transfer(ammMock.address, usdc(50));

        // Mint some instances of the CKToken
        await setup.approveAndIssueCKToken(ckToken, ether(1));
      });

      describe("#removeLiquidity", async () => {
        let subjectComponentsToOutput: Address[];
        let subjectMinComponentQuantities: BigNumber[];
        let subjectPoolTokens: BigNumber;

        beforeEach(async () => {
          subjectCKToken = ckToken.address;
          subjectIntegrationName = "BALANCER";
          subjectAmmPool = ammMock.address;
          subjectComponentsToOutput = [setup.dai.address, setup.usdc.address];
          subjectMinComponentQuantities = [ether(50), usdc(50)];
          subjectPoolTokens = ether(1);
          subjectCaller = owner;
        });

        async function subject(): Promise<any> {
          return await ammModule.connect(subjectCaller.wallet).removeLiquidity(
            subjectCKToken,
            subjectIntegrationName,
            subjectAmmPool,
            subjectPoolTokens,
            subjectComponentsToOutput,
            subjectMinComponentQuantities,
          );
        }

        it("should reduce the liquidity token of the caller", async () => {
          const previousLiquidityTokenBalance = await ammMock.balanceOf(subjectCKToken);

          await subject();
          const liquidityTokenBalance = await ammMock.balanceOf(subjectCKToken);
          const expectedLiquidityBalance = previousLiquidityTokenBalance.sub(subjectPoolTokens);
          expect(liquidityTokenBalance).to.eq(expectedLiquidityBalance);
        });

        it("should update the positions properly", async () => {
          await subject();
          const positions = await ckToken.getPositions();

          expect(positions.length).to.eq(2);

          expect(positions[0].component).to.eq(setup.dai.address);
          expect(positions[0].unit).to.eq(ether(50));
          expect(positions[1].component).to.eq(setup.usdc.address);
          expect(positions[1].unit).to.eq(usdc(50));
        });

        it("should emit the correct events", async () => {
          await expect(subject()).to.emit(ammModule, "LiquidityRemoved").withArgs(
            subjectCKToken,
            subjectAmmPool,
            subjectPoolTokens.mul(-1),
            subjectComponentsToOutput,
            subjectMinComponentQuantities
          );
        });

        describe("when liquidity token quantity is 0", async () => {
          beforeEach(async () => {
            subjectPoolTokens = ZERO;
          });

          it("should revert", async () => {
            await expect(subject()).to.be.revertedWith("Token quantity must be nonzero");
          });
        });

        describe("when the CKToken does not own enough of the liquidity token", async () => {
          beforeEach(async () => {
            subjectPoolTokens = ether(1000);
          });

          it("should revert", async () => {
            await expect(subject()).to.be.revertedWith("CKToken must own enough liquidity token");
          });
        });

        describe("when a component unit is zero", async () => {
          beforeEach(async () => {
            subjectMinComponentQuantities = [ether(0), usdc(50)];
          });

          it("should revert", async () => {
            await expect(subject()).to.be.revertedWith("Component quantity must be nonzero");
          });
        });

        describe("when insufficient underlying tokens are received", async () => {
          beforeEach(async () => {
            await ammMock.setMintLessThanMinimum();
          });

          it("should revert", async () => {
            await expect(subject()).to.be.revertedWith("Underlying tokens received must be greater than minimum specified");
          });
        });

        describe("when the components and units arrays are different lengths", async () => {
          beforeEach(async () => {
            subjectComponentsToOutput = [setup.dai.address];
          });

          it("should revert", async () => {
            await expect(subject()).to.be.revertedWith("Components and units must be equal length");
          });
        });

        shouldRevertIfTheCallerIsNotTheManager(subject);
        shouldRevertIfCKTokenIsInvalid(subject);
        shouldRevertIfModuleDisabled(subject);
        shouldRevertIfPoolIsNotSupported(subject);
        shouldRevertIfTheIntegrationIsInvalid(subject);
      });

      describe("#removeLiquiditySingleAsset", async () => {
        let subjectComponentToOutput: Address;
        let subjectMinComponentQuantity: BigNumber;
        let subjectPoolTokens: BigNumber;

        beforeEach(async () => {
          subjectCKToken = ckToken.address;
          subjectIntegrationName = "BALANCER";
          subjectAmmPool = ammMock.address;
          subjectComponentToOutput = setup.dai.address;
          subjectMinComponentQuantity = ether(50);
          subjectPoolTokens = ether(1);
          subjectCaller = owner;
        });

        async function subject(): Promise<any> {
          return await ammModule.connect(subjectCaller.wallet).removeLiquiditySingleAsset(
            subjectCKToken,
            subjectIntegrationName,
            subjectAmmPool,
            subjectPoolTokens,
            subjectComponentToOutput,
            subjectMinComponentQuantity,
          );
        }

        it("should reduce the liquidity token of the caller", async () => {
          const previousLiquidityTokenBalance = await ammMock.balanceOf(subjectCKToken);

          await subject();
          const liquidityTokenBalance = await ammMock.balanceOf(subjectCKToken);
          const expectedLiquidityBalance = previousLiquidityTokenBalance.sub(subjectPoolTokens);
          expect(liquidityTokenBalance).to.eq(expectedLiquidityBalance);
        });

        it("should update the positions properly", async () => {
          await subject();
          const positions = await ckToken.getPositions();
          expect(positions.length).to.eq(1);

          expect(positions[0].component).to.eq(setup.dai.address);
          expect(positions[0].unit).to.eq(ether(50));
        });

        it("should emit the correct events", async () => {
          await expect(subject()).to.emit(ammModule, "LiquidityRemoved").withArgs(
            subjectCKToken,
            subjectAmmPool,
            subjectPoolTokens.mul(-1),
            [subjectComponentToOutput],
            [subjectMinComponentQuantity]
          );
        });

        describe("when liquidity token quantity is 0", async () => {
          beforeEach(async () => {
            subjectPoolTokens = ZERO;
          });

          it("should revert", async () => {
            await expect(subject()).to.be.revertedWith("Token quantity must be nonzero");
          });
        });

        describe("when the CKToken does not own enough of the liquidity token", async () => {
          beforeEach(async () => {
            subjectPoolTokens = ether(1000);
          });

          it("should revert", async () => {
            await expect(subject()).to.be.revertedWith("CKToken must own enough liquidity token");
          });
        });

        describe("when a component unit is zero", async () => {
          beforeEach(async () => {
            subjectMinComponentQuantity = ether(0);
          });

          it("should revert", async () => {
            await expect(subject()).to.be.revertedWith("Component quantity must be nonzero");
          });
        });

        describe("when insufficient underlying tokens are received", async () => {
          beforeEach(async () => {
            await ammMock.setMintLessThanMinimum();
          });

          it("should revert", async () => {
            await expect(subject()).to.be.revertedWith("Underlying tokens received must be greater than minimum specified");
          });
        });

        shouldRevertIfTheCallerIsNotTheManager(subject);
        shouldRevertIfCKTokenIsInvalid(subject);
        shouldRevertIfModuleDisabled(subject);
        shouldRevertIfPoolIsNotSupported(subject);
        shouldRevertIfTheIntegrationIsInvalid(subject);
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

    function shouldRevertIfCKTokenIsInvalid(subject: any) {
      describe("when the CKToken is invalid", async () => {
        beforeEach(async () => {
          const newCKToken: CKToken = await setup.createNonControllerEnabledCKToken(
            [setup.dai.address, setup.usdc.address],
            [ether(50), usdc(50)],
            [ammModule.address]
          );
          subjectCKToken = newCKToken.address;
        });


        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Must be a valid and initialized CKToken");
        });
      });
    }

    function shouldRevertIfModuleDisabled(subject: any) {
      describe("when the module is disabled", async () => {
        beforeEach(async () => {
          await ckToken.removeModule(ammModule.address);
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Must be a valid and initialized CKToken");
        });
      });
    }

    function shouldRevertIfPoolIsNotSupported(subject: any) {
      describe("when the pool is not supported on the adapter", async () => {
        beforeEach(async () => {
          subjectAmmPool = setup.wbtc.address;
        });


        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Pool token must be enabled on the Adapter");
        });
      });
    }

    function shouldRevertIfTheIntegrationIsInvalid(subject: any) {
      describe("when the integration name is not supported on the registry", async () => {
        beforeEach(async () => {
          subjectIntegrationName = "CURVE";
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Must be valid adapter");
        });
      });
    }
  });
});