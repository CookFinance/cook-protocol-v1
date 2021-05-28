import "module-alias/register";

import { BigNumber } from "@ethersproject/bignumber";
import { Address } from "@utils/types";
import { Account } from "@utils/test/types";
import { ModuleBaseMock, CKToken, StandardTokenMock, StandardTokenWithFeeMock } from "@utils/contracts";
import { MAX_UINT_256, ZERO } from "@utils/constants";
import DeployHelper from "@utils/deploys";
import {
  ether,
  hashAdapterName,
  preciseMul,
} from "@utils/index";
import {
  getAccounts,
  getRandomAddress,
  getRandomAccount,
  getSystemFixture,
  getWaffleExpect,
  addSnapshotBeforeRestoreAfterEach,
} from "@utils/test/index";
import { SystemFixture } from "@utils/fixtures";

const expect = getWaffleExpect();

describe("ModuleBase", () => {
  let owner: Account;
  let otherAccount: Account;
  let deployer: DeployHelper;

  let setup: SystemFixture;
  let moduleBase: ModuleBaseMock;
  let dummyModule: Account;

  before(async () => {
    [
      owner,
      otherAccount,
      dummyModule,
    ] = await getAccounts();

    setup = getSystemFixture(owner.address);
    await setup.initialize();
    deployer = new DeployHelper(owner.wallet);
  });

  addSnapshotBeforeRestoreAfterEach();

  describe("#constructor", async () => {
    let subjectModuleBase: ModuleBaseMock;

    async function subject(): Promise<ModuleBaseMock> {
      return deployer.mocks.deployModuleBaseMock(setup.controller.address);
    }

    it("should have the correct controller", async () => {
      subjectModuleBase = await subject();
      const expectedController = await subjectModuleBase.controller();
      expect(expectedController).to.eq(setup.controller.address);
    });
  });

  context("when there is a CKToken with an enabled module", async () => {
    let ckToken: CKToken;
    let ckTokenManager: Address;

    beforeEach(async () => {
      moduleBase = await deployer.mocks.deployModuleBaseMock(setup.controller.address);

      await setup.controller.addModule(moduleBase.address);
      await setup.controller.addModule(dummyModule.address);

      ckTokenManager = owner.address;

      ckToken = await setup.createCKToken(
        [setup.weth.address, setup.usdc.address],
        [ether(1), ether(200)],
        [moduleBase.address, dummyModule.address],
        ckTokenManager,
      );
    });

    describe("#testGetAndValidateAdapter", async () => {
      let subjectIntegrationName: Address;
      let adapterAddress: Address;

      beforeEach(async () => {
        subjectIntegrationName = "CURVE";
        adapterAddress = otherAccount.address;
        await setup.integrationRegistry.addIntegration(
          moduleBase.address,
          subjectIntegrationName,
          adapterAddress
        );
      });

      async function subject(): Promise<string> {
        return moduleBase.testGetAndValidateAdapter(subjectIntegrationName);
      }

      it("should return the correct adapter", async () => {
        const adapter = await subject();
        expect(adapter).to.eq(adapterAddress);
      });

      describe("when the adapter name has an invalid adapter", async () => {
        beforeEach(async () => {
          subjectIntegrationName = "NA";
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Must be valid adapter");
        });
      });
    });

    describe("#testGetAndValidateAdapterWithHash", async () => {
      let subjectIntegrationHash: Address;
      let adapterAddress: Address;

      beforeEach(async () => {
        const integrationName = "CURVE";
        adapterAddress = otherAccount.address;
        await setup.integrationRegistry.addIntegration(
          moduleBase.address,
          integrationName,
          adapterAddress
        );

        subjectIntegrationHash = hashAdapterName(integrationName);
      });

      async function subject(): Promise<string> {
        return moduleBase.testGetAndValidateAdapterWithHash(subjectIntegrationHash);
      }

      it("should return the correct adapter", async () => {
        const adapter = await subject();
        expect(adapter).to.eq(adapterAddress);
      });

      describe("when the adapter name has an invalid adapter", async () => {
        beforeEach(async () => {
          subjectIntegrationHash = hashAdapterName("NA");
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Must be valid adapter");
        });
      });
    });

    describe("#testGetModuleFee", async () => {
      let subjectFeeIndex: BigNumber;
      let subjectQuantity: BigNumber;

      let feePercentage: BigNumber;

      beforeEach(async () => {
        subjectFeeIndex = ZERO;
        subjectQuantity = ether(1);
        feePercentage = ether(0.05); // 5%
        await setup.controller.addFee(
          moduleBase.address,
          subjectFeeIndex,
          feePercentage
        );
      });

      async function subject(): Promise<BigNumber> {
        return moduleBase.testGetModuleFee(subjectFeeIndex, subjectQuantity);
      }

      it("should return the correct fee", async () => {
        const returnedFee = await subject();
        const expectedFee = preciseMul(subjectQuantity, feePercentage);
        expect(returnedFee).to.eq(expectedFee);
      });
    });

    describe("#testPayProtocolFeeFromCKToken", async () => {
      let subjectCKToken: Address;
      let subjectComponent: Address;
      let subjectFeeQuantity: BigNumber;

      let feeRecipient: Address;

      beforeEach(async () => {
        subjectCKToken = ckToken.address;
        subjectComponent = setup.dai.address;
        subjectFeeQuantity = ether(1);

        feeRecipient = otherAccount.address;

        await setup.dai.transfer(subjectCKToken, subjectFeeQuantity);
        await setup.controller.editFeeRecipient(feeRecipient);

        await moduleBase.initializeModuleOnCK(subjectCKToken);
      });

      async function subject(): Promise<any> {
        return moduleBase.testPayProtocolFeeFromCKToken(
          subjectCKToken,
          subjectComponent,
          subjectFeeQuantity
        );
      }

      it("should send the fee the the fee recipient", async () => {
        await subject();
        const retrievedFeeRecipientBalance = await setup.dai.balanceOf(feeRecipient);
        expect(retrievedFeeRecipientBalance).to.eq(subjectFeeQuantity);
      });
    });

    describe("#testTransferFrom", async () => {
      let token: StandardTokenMock;
      let quantity: BigNumber;

      let subjectTokenAddress: Address;
      let subjectFromAddress: Address;
      let subjectToAddress: Address;
      let subjectQuantity: BigNumber;

      beforeEach(async () => {
        token = await deployer.mocks.deployTokenMock(owner.address);

        token = token.connect(owner.wallet);
        await token.connect(owner.wallet).approve(moduleBase.address, MAX_UINT_256);

        quantity = ether(1);

        subjectTokenAddress = token.address;
        subjectFromAddress = owner.address;
        subjectToAddress = otherAccount.address;
        subjectQuantity = ether(1);
      });

      async function subject(): Promise<any> {
        return moduleBase.testTransferFrom(
          subjectTokenAddress,
          subjectFromAddress,
          subjectToAddress,
          subjectQuantity
        );
      }

      it("should decrement the balance of the from address", async () => {
        const previousBalance = await token.balanceOf(owner.address);

        await subject();

        const newBalance = await token.balanceOf(owner.address);
        const expectedBalance = previousBalance.sub(quantity);

        await expect(newBalance).to.eq(expectedBalance);
      });

      it("should increment the balance of the to address", async () => {
        const previousBalance = await token.balanceOf(subjectToAddress);

        await subject();

        const newBalance = await token.balanceOf(subjectToAddress);
        const expectedBalance = previousBalance.add(quantity);

        await expect(newBalance).to.eq(expectedBalance);
      });

      describe("when the transfer quantity is 0", async () => {
        beforeEach(async () => {
          subjectQuantity = ZERO;
        });

        it("should not change the balance of the user", async () => {
          const previousBalance = await token.balanceOf(subjectToAddress);

          await subject();

          const newBalance = await token.balanceOf(subjectToAddress);

          await expect(newBalance).to.eq(previousBalance);
        });
      });

      describe("when the token has a transfer fee", async () => {
        let mockTokenWithFee: StandardTokenWithFeeMock;

        beforeEach(async () => {
          mockTokenWithFee = await deployer.mocks.deployTokenWithFeeMock(owner.address);

          mockTokenWithFee = mockTokenWithFee.connect(owner.wallet);
          await mockTokenWithFee.approve(moduleBase.address, MAX_UINT_256);

          subjectTokenAddress = mockTokenWithFee.address;
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Invalid post transfer balance");
        });
      });

      describe("when the token is not approved for transfer", async () => {
        beforeEach(async () => {
          await token.approve(moduleBase.address, ZERO);
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("ERC20: transfer amount exceeds allowance");
        });
      });
    });

    describe("#testIsCKPendingInitialization", async () => {
      let subjectCKTokenAddress: Address;

      beforeEach(async () => {
        subjectCKTokenAddress = ckToken.address;
      });

      async function subject(): Promise<boolean> {
        return moduleBase.testIsCKPendingInitialization(subjectCKTokenAddress);
      }

      it("should return true", async () => {
        const isModulePending = await subject();
        expect(isModulePending).to.eq(true);
      });

      describe("when the CKToken has not put the module into a pending state", async () => {
        beforeEach(async () => {
          const nonPendingModule = await getRandomAddress();
          await setup.controller.addModule(nonPendingModule);

          const ckTokenWithNonPendingModule = await setup.createCKToken(
            [setup.weth.address, setup.usdc.address],
            [ether(1), ether(200)],
            [nonPendingModule]
          );
          subjectCKTokenAddress = ckTokenWithNonPendingModule.address;
        });

        it("should return false", async () => {
          const isModulePending = await subject();
          expect(isModulePending).to.eq(false);
        });
      });
    });

    describe("#testIsCKManager", async () => {
      let subjectCKTokenAddress: Address;
      let subjectAddressToCheck: Address;

      beforeEach(async () => {
        subjectCKTokenAddress = ckToken.address;
        subjectAddressToCheck = owner.address;
      });

      async function subject(): Promise<boolean> {
        return moduleBase.testIsCKManager(subjectCKTokenAddress, subjectAddressToCheck);
      }

      it("should return true when the testOnlyCKManager is calling", async () => {
        const isManager = await subject();
        expect(isManager).to.eq(true);
      });

      describe("when the caller is not the manager", async () => {
        beforeEach(async () => {
          subjectAddressToCheck = await getRandomAddress();
        });

        it("should return false", async () => {
          const isManager = await subject();
          expect(isManager).to.eq(false);
        });
      });
    });

    describe("#testIsCKValidAndInitialized", async () => {
      let subjectCKTokenAddress: Address;

      beforeEach(async () => {
        await moduleBase.initializeModuleOnCK(ckToken.address);
        subjectCKTokenAddress = ckToken.address;
      });

      async function subject(): Promise<boolean> {
        return moduleBase.testIsCKValidAndInitialized(subjectCKTokenAddress);
      }

      it("should return true when the module is enabled on the CKToken", async () => {
        const isValidSet = await subject();
        expect(isValidSet).to.eq(true);
      });

      describe("when the module is not enabled on the CK", async () => {
        beforeEach(async () => {
          const nonPendingModule = await getRandomAddress();
          await setup.controller.addModule(nonPendingModule);
          const ckTokenWithNonPendingModule = await setup.createCKToken(
            [setup.weth.address, setup.usdc.address],
            [ether(1), ether(200)],
            [nonPendingModule]
          );
          subjectCKTokenAddress = ckTokenWithNonPendingModule.address;
        });

        it("should return false", async () => {
          const isManager = await subject();
          expect(isManager).to.eq(false);
        });
      });

      describe("when the module is enabled on the CK, but not enabled on the Controller", async () => {
        beforeEach(async () => {
          const nonEnabledCKToken = await deployer.core.deployCKToken(
            [setup.weth.address, setup.usdc.address],
            [ether(1), ether(200)],
            [moduleBase.address],
            setup.controller.address,
            owner.address,
            "CKT",
            "CKT"
          );
          subjectCKTokenAddress = nonEnabledCKToken.address;
        });

        it("should return false", async () => {
          const isManager = await subject();
          expect(isManager).to.eq(false);
        });
      });
    });

    describe("#testOnlyManagerAndValidCK", async () => {
      let subjectCaller: Account;
      let subjectCKTokenAddress: Address;

      beforeEach(async () => {
        subjectCaller = owner;

        await moduleBase.initializeModuleOnCK(ckToken.address);
        subjectCKTokenAddress = ckToken.address;
      });

      async function subject(): Promise<any> {
        moduleBase = moduleBase.connect(subjectCaller.wallet);
        return moduleBase.testOnlyManagerAndValidCK(subjectCKTokenAddress);
      }

      it("should not revert if the manager is calling", async () => {
        await expect(subject()).to.not.be.reverted;
      });

      describe("when called by a different address", async () => {
        beforeEach(async () => {
          subjectCaller = await getRandomAccount();
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Must be the CKToken manager");
        });
      });

      describe("when the module is not enabled on the CK", async () => {
        beforeEach(async () => {
          const nonPendingModule = await getRandomAddress();
          await setup.controller.addModule(nonPendingModule);
          const ckTokenWithNonPendingModule = await setup.createCKToken(
            [setup.weth.address, setup.usdc.address],
            [ether(1), ether(200)],
            [nonPendingModule]
          );
          subjectCKTokenAddress = ckTokenWithNonPendingModule.address;
        });

        it("should revert", async () => {
          await expect(subject()).to.be.reverted;
        });
      });

      describe("when the module is enabled on the CK, but not enabled on the Controller", async () => {
        beforeEach(async () => {
          const nonEnabledCKToken = await deployer.core.deployCKToken(
            [setup.weth.address, setup.usdc.address],
            [ether(1), ether(200)],
            [moduleBase.address],
            setup.controller.address,
            owner.address,
            "CKT",
            "CKT"
          );
          subjectCKTokenAddress = nonEnabledCKToken.address;
        });

        it("should revert", async () => {
          await expect(subject()).to.be.reverted;
        });
      });
    });

    describe("#testOnlyCKManager", async () => {
      let subjectCaller: Account;

      beforeEach(async () => {
        subjectCaller = owner;
      });

      async function subject(): Promise<any> {
        moduleBase = moduleBase.connect(subjectCaller.wallet);
        return moduleBase.testOnlyCKManager(ckToken.address);
      }

      it("should not revert if the manager is calling", async () => {
        await expect(subject()).to.not.be.reverted;
      });

      describe("when called by a different address", async () => {
        beforeEach(async () => {
          subjectCaller = await getRandomAccount();
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Must be the CKToken manager");
        });
      });
    });

    describe("#testOnlyModule", async () => {
      let subjectCKTokenAddress: Address;
      let subjectCaller: Account;

      beforeEach(async () => {
        await ckToken.connect(dummyModule.wallet).initializeModule();

        subjectCKTokenAddress = ckToken.address;
        subjectCaller = dummyModule;
      });

      async function subject(): Promise<void> {
        return moduleBase.connect(subjectCaller.wallet).testOnlyModule(subjectCKTokenAddress);
      }

      it("should not revert if an approved module is calling", async () => {
        await expect(subject()).to.not.be.reverted;
      });

      describe("when the caller is not an approved module", async () => {
        beforeEach(async () => {
          subjectCaller = owner;
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Only the module can call");
        });
      });
    });

    describe("#testOnlyValidInitialization", async () => {
      let subjectCKTokenAddress: Address;

      beforeEach(async () => {
        subjectCKTokenAddress = ckToken.address;
      });

      async function subject(): Promise<any> {
        return moduleBase.testOnlyValidInitialization(subjectCKTokenAddress);
      }

      it("should not revert", async () => {
        await expect(subject()).to.not.be.reverted;
      });

      describe("when the module is in NONE state on the CK", async () => {
        beforeEach(async () => {
          const nonPendingModule = await getRandomAddress();
          await setup.controller.addModule(nonPendingModule);
          const ckTokenWithNonPendingModule = await setup.createCKToken(
            [setup.weth.address, setup.usdc.address],
            [ether(1), ether(200)],
            [nonPendingModule]
          );
          subjectCKTokenAddress = ckTokenWithNonPendingModule.address;
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Must be pending initialization");
        });
      });

      describe("when the module is in initialized state on the CK", async () => {
        beforeEach(async () => {
          await moduleBase.initializeModuleOnCK(ckToken.address);
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Must be pending initialization");
        });
      });

      describe("when the CKToken is not enabled on the Controller", async () => {
        beforeEach(async () => {
          const nonEnabledCKToken = await deployer.core.deployCKToken(
            [setup.weth.address, setup.usdc.address],
            [ether(1), ether(200)],
            [moduleBase.address],
            setup.controller.address,
            owner.address,
            "CKT",
            "CKT"
          );
          subjectCKTokenAddress = nonEnabledCKToken.address;
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Must be controller-enabled CKToken");
        });
      });
    });

    describe("#testOnlyValidAndInitializedCK", async () => {
      let subjectCKTokenAddress: Address;

      beforeEach(async () => {
        await moduleBase.initializeModuleOnCK(ckToken.address);
        subjectCKTokenAddress = ckToken.address;
      });

      async function subject(): Promise<any> {
        return moduleBase.testOnlyValidAndInitializedCK(subjectCKTokenAddress);
      }

      it("should not revert", async () => {
        await expect(subject()).to.not.be.reverted;
      });

      describe("when the module is not enabled on the CK", async () => {
        beforeEach(async () => {
          const nonPendingModule = await getRandomAddress();
          await setup.controller.addModule(nonPendingModule);
          const ckTokenWithNonPendingModule = await setup.createCKToken(
            [setup.weth.address, setup.usdc.address],
            [ether(1), ether(200)],
            [nonPendingModule]
          );
          subjectCKTokenAddress = ckTokenWithNonPendingModule.address;
        });

        it("should revert", async () => {
          await expect(subject()).to.be.reverted;
        });
      });

      describe("when the module is enabled on the CK, but not enabled on the Controller", async () => {
        beforeEach(async () => {
          const nonEnabledCKToken = await deployer.core.deployCKToken(
            [setup.weth.address, setup.usdc.address],
            [ether(1), ether(200)],
            [moduleBase.address],
            setup.controller.address,
            owner.address,
            "CKT",
            "CKT"
          );
          subjectCKTokenAddress = nonEnabledCKToken.address;
        });

        it("should revert", async () => {
          await expect(subject()).to.be.reverted;
        });
      });
    });
  });
});
