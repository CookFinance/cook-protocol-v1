import "module-alias/register";
import { BigNumber } from "@ethersproject/bignumber";

import { Address } from "@utils/types";
import { Account } from "@utils/test/types";
import { ADDRESS_ZERO, ZERO } from "@utils/constants";
import { CKToken, WrapAdapterMock, WrapModule } from "@utils/contracts";
import DeployHelper from "@utils/deploys";
import {
  ether,
  preciseMul,
} from "@utils/index";
import {
  addSnapshotBeforeRestoreAfterEach,
  getAccounts,
  getProvider,
  getRandomAccount,
  getRandomAddress,
  getSystemFixture,
  getWaffleExpect,
} from "@utils/test/index";
import { SystemFixture } from "@utils/fixtures";

const expect = getWaffleExpect();

describe("WrapModule", () => {
  let owner: Account;
  let deployer: DeployHelper;
  let setup: SystemFixture;

  let wrapModule: WrapModule;
  let wrapAdapterMock: WrapAdapterMock;

  const wrapAdapterMockIntegrationName: string = "MOCK_WRAPPER";

  before(async () => {
    [
      owner,
    ] = await getAccounts();

    deployer = new DeployHelper(owner.wallet);
    setup = getSystemFixture(owner.address);
    await setup.initialize();

    wrapModule = await deployer.modules.deployWrapModule(setup.controller.address, setup.weth.address);
    await setup.controller.addModule(wrapModule.address);

    wrapAdapterMock = await deployer.mocks.deployWrapAdapterMock();
    await setup.integrationRegistry.addIntegration(wrapModule.address, wrapAdapterMockIntegrationName, wrapAdapterMock.address);
  });

  addSnapshotBeforeRestoreAfterEach();

  describe("#constructor", async () => {
    let subjectController: Address;
    let subjectWETH: Address;

    beforeEach(async () => {
      subjectController = setup.controller.address;
      subjectWETH = setup.weth.address;
    });

    async function subject(): Promise<WrapModule> {
      return deployer.modules.deployWrapModule(subjectController, subjectWETH);
    }

    it("should set the correct controller", async () => {
      const wrapModule = await subject();

      const controller = await wrapModule.controller();
      expect(controller).to.eq(subjectController);
    });

    it("should set the correct weth contract", async () => {
      const wrapModule = await subject();

      const weth = await wrapModule.weth();
      expect(weth).to.eq(subjectWETH);
    });
  });

  describe("#initialize", async () => {
    let ckToken: CKToken;
    let subjectCKToken: Address;
    let subjectCaller: Account;

    beforeEach(async () => {
      ckToken = await setup.createCKToken(
        [setup.weth.address],
        [ether(1)],
        [wrapModule.address]
      );
      subjectCKToken = ckToken.address;
      subjectCaller = owner;
    });

    async function subject(): Promise<any> {
      return wrapModule.connect(subjectCaller.wallet).initialize(subjectCKToken);
    }

    it("should enable the Module on the CKToken", async () => {
      await subject();
      const isModuleEnabled = await ckToken.isInitializedModule(wrapModule.address);
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

        const wrapModuleNotPendingCKToken = await setup.createCKToken(
          [setup.weth.address],
          [ether(1)],
          [newModule]
        );

        subjectCKToken = wrapModuleNotPendingCKToken.address;
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
          [wrapModule.address]
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
    let subjectCaller: Account;
    let subjectModule: Address;

    beforeEach(async () => {
      ckToken = await setup.createCKToken(
        [setup.weth.address],
        [ether(1)],
        [wrapModule.address]
      );
      await wrapModule.initialize(ckToken.address);

      subjectModule = wrapModule.address;
      subjectCaller = owner;
    });

    async function subject(): Promise<any> {
      return ckToken.connect(subjectCaller.wallet).removeModule(subjectModule);
    }

    it("should properly remove the module", async () => {
      await subject();
      const isModuleEnabled = await ckToken.isInitializedModule(subjectModule);
      expect(isModuleEnabled).to.eq(false);
    });
  });

  context("when a CKToken has been deployed and issued", async () => {
    let ckToken: CKToken;
    let ckTokensIssued: BigNumber;

    before(async () => {
      ckToken = await setup.createCKToken(
        [setup.weth.address],
        [ether(1)],
        [setup.issuanceModule.address, wrapModule.address]
      );

      // Initialize modules
      await setup.issuanceModule.initialize(ckToken.address, ADDRESS_ZERO);
      await wrapModule.initialize(ckToken.address);

      // Issue some CKs
      ckTokensIssued = ether(10);
      const underlyingRequired = ckTokensIssued;
      await setup.weth.approve(setup.issuanceModule.address, underlyingRequired);
      await setup.issuanceModule.issue(ckToken.address, ckTokensIssued, owner.address);
    });

    describe("#wrap", async () => {
      let subjectCKToken: Address;
      let subjectUnderlyingToken: Address;
      let subjectWrappedToken: Address;
      let subjectUnderlyingUnits: BigNumber;
      let subjectIntegrationName: string;
      let subjectCaller: Account;

      beforeEach(async () => {
        subjectCKToken = ckToken.address;
        subjectUnderlyingToken = setup.weth.address;
        subjectWrappedToken = wrapAdapterMock.address;
        subjectUnderlyingUnits = ether(1);
        subjectIntegrationName = wrapAdapterMockIntegrationName;
        subjectCaller = owner;
      });

      async function subject(): Promise<any> {
        return wrapModule.connect(subjectCaller.wallet).wrap(
          subjectCKToken,
          subjectUnderlyingToken,
          subjectWrappedToken,
          subjectUnderlyingUnits,
          subjectIntegrationName,
        );
      }

      it("should mint the correct wrapped asset to the CKToken", async () => {
        await subject();
        const wrappedBalance = await wrapAdapterMock.balanceOf(ckToken.address);
        const expectedTokenBalance = ckTokensIssued;
        expect(wrappedBalance).to.eq(expectedTokenBalance);
      });

      it("should reduce the correct quantity of the underlying quantity", async () => {
        const previousUnderlyingBalance = await setup.weth.balanceOf(ckToken.address);

        await subject();
        const underlyingTokenBalance = await setup.weth.balanceOf(ckToken.address);
        const expectedUnderlyingBalance = previousUnderlyingBalance.sub(ckTokensIssued);
        expect(underlyingTokenBalance).to.eq(expectedUnderlyingBalance);
      });

      it("remove the underlying position and replace with the wrapped token position", async () => {
        await subject();

        const positions = await ckToken.getPositions();
        const receivedWrappedTokenPosition = positions[0];

        expect(positions.length).to.eq(1);
        expect(receivedWrappedTokenPosition.component).to.eq(subjectWrappedToken);
        expect(receivedWrappedTokenPosition.unit).to.eq(subjectUnderlyingUnits);
      });

      it("emits the correct ComponentWrapped event", async () => {
        await expect(subject()).to.emit(wrapModule, "ComponentWrapped").withArgs(
          ckToken.address,
          subjectUnderlyingToken,
          subjectWrappedToken,
          preciseMul(subjectUnderlyingUnits, ckTokensIssued),
          ckTokensIssued,
          subjectIntegrationName
        );
      });

      describe("when the integration ID is invalid", async () => {
        beforeEach(async () => {
          subjectIntegrationName = "INVALID_NAME";
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Must be valid adapter");
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
          const newCKToken = await setup.createCKToken(
            [setup.weth.address],
            [ether(1)],
            [setup.issuanceModule.address, wrapModule.address]
          );

          subjectCKToken = newCKToken.address;
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Must be a valid and initialized CKToken");
        });
      });

      describe("when the subjectComponent is not a Default Position", async () => {
        beforeEach(async () => {
          subjectUnderlyingToken = await getRandomAddress();
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Target default position must be component");
        });
      });

      describe("when the units is greater than on the position", async () => {
        beforeEach(async () => {
          subjectUnderlyingUnits = ether(100);
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Unit cant be greater than existing");
        });
      });

      describe("when the underlying units is 0", async () => {
        beforeEach(async () => {
          subjectUnderlyingUnits = ZERO;
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Target position units must be > 0");
        });
      });
    });

    describe("#wrapWithEther", async () => {
      let subjectCKToken: Address;
      let subjectWrappedToken: Address;
      let subjectUnderlyingUnits: BigNumber;
      let subjectIntegrationName: string;
      let subjectCaller: Account;

      beforeEach(async () => {
        subjectCKToken = ckToken.address;
        subjectWrappedToken = wrapAdapterMock.address;
        subjectUnderlyingUnits = ether(1);
        subjectIntegrationName = wrapAdapterMockIntegrationName;
        subjectCaller = owner;
      });

      async function subject(): Promise<any> {
        return wrapModule.connect(subjectCaller.wallet).wrapWithEther(
          subjectCKToken,
          subjectWrappedToken,
          subjectUnderlyingUnits,
          subjectIntegrationName,
        );
      }

      it("should mint the correct wrapped asset to the CKToken", async () => {
        await subject();
        const wrappedBalance = await wrapAdapterMock.balanceOf(ckToken.address);
        const expectedTokenBalance = ckTokensIssued;
        expect(wrappedBalance).to.eq(expectedTokenBalance);
      });

      it("should reduce the correct quantity of WETH", async () => {
        const previousUnderlyingBalance = await setup.weth.balanceOf(ckToken.address);

        await subject();
        const underlyingTokenBalance = await setup.weth.balanceOf(ckToken.address);
        const expectedUnderlyingBalance = previousUnderlyingBalance.sub(ckTokensIssued);
        expect(underlyingTokenBalance).to.eq(expectedUnderlyingBalance);
      });

      it("should send the correct quantity of ETH to the external protocol", async () => {
        const provider = getProvider();
        const preEthBalance = await provider.getBalance(wrapAdapterMock.address);

        await subject();

        const postEthBalance = await provider.getBalance(wrapAdapterMock.address);
        expect(postEthBalance).to.eq(preEthBalance.add(preciseMul(subjectUnderlyingUnits, ckTokensIssued)));
      });

      it("removes the underlying position and replace with the wrapped token position", async () => {
        await subject();

        const positions = await ckToken.getPositions();
        const receivedWrappedTokenPosition = positions[0];

        expect(positions.length).to.eq(1);
        expect(receivedWrappedTokenPosition.component).to.eq(subjectWrappedToken);
        expect(receivedWrappedTokenPosition.unit).to.eq(subjectUnderlyingUnits);
      });

      it("emits the correct ComponentWrapped event", async () => {
        await expect(subject()).to.emit(wrapModule, "ComponentWrapped").withArgs(
          ckToken.address,
          setup.weth.address,
          subjectWrappedToken,
          preciseMul(subjectUnderlyingUnits, ckTokensIssued),
          ckTokensIssued,
          subjectIntegrationName
        );
      });

      describe("when the integration ID is invalid", async () => {
        beforeEach(async () => {
          subjectIntegrationName = "INVALID_NAME";
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Must be valid adapter");
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
          const newCKToken = await setup.createCKToken(
            [setup.weth.address],
            [ether(1)],
            [setup.issuanceModule.address, wrapModule.address]
          );

          subjectCKToken = newCKToken.address;
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Must be a valid and initialized CKToken");
        });
      });

      describe("when WETH is not a Default Position", async () => {
        beforeEach(async () => {
          const nonWethCKToken = await setup.createCKToken(
            [setup.wbtc.address],
            [ether(1)],
            [setup.issuanceModule.address, wrapModule.address]
          );

          // Initialize modules
          await setup.issuanceModule.initialize(nonWethCKToken.address, ADDRESS_ZERO);
          await wrapModule.initialize(nonWethCKToken.address);

          subjectCKToken = nonWethCKToken.address;
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Target default position must be component");
        });
      });

      describe("when the units is greater than on the position", async () => {
        beforeEach(async () => {
          subjectUnderlyingUnits = ether(100);
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Unit cant be greater than existing");
        });
      });

      describe("when the underlying units is 0", async () => {
        beforeEach(async () => {
          subjectUnderlyingUnits = ZERO;
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Target position units must be > 0");
        });
      });
    });

    describe("#unwrap", async () => {
      let subjectCKToken: Address;
      let subjectUnderlyingToken: Address;
      let subjectWrappedToken: Address;
      let subjectWrappedTokenUnits: BigNumber;
      let subjectIntegrationName: string;
      let subjectCaller: Account;

      let wrappedQuantity: BigNumber;

      beforeEach(async () => {
        subjectCKToken = ckToken.address;
        subjectUnderlyingToken = setup.weth.address;
        subjectWrappedToken = wrapAdapterMock.address;
        subjectWrappedTokenUnits = ether(0.5);
        subjectIntegrationName = wrapAdapterMockIntegrationName;
        subjectCaller = owner;

        wrappedQuantity = ether(1);

        await wrapModule.wrap(
          subjectCKToken,
          subjectUnderlyingToken,
          subjectWrappedToken,
          wrappedQuantity,
          subjectIntegrationName,
        );
      });

      async function subject(): Promise<any> {
        return wrapModule.connect(subjectCaller.wallet).unwrap(
          subjectCKToken,
          subjectUnderlyingToken,
          subjectWrappedToken,
          subjectWrappedTokenUnits,
          subjectIntegrationName,
        );
      }

      it("should burn the correct wrapped asset to the CKToken", async () => {
        await subject();
        const newWrappedBalance = await wrapAdapterMock.balanceOf(ckToken.address);
        const expectedTokenBalance = preciseMul(ckTokensIssued, wrappedQuantity.sub(subjectWrappedTokenUnits));
        expect(newWrappedBalance).to.eq(expectedTokenBalance);
      });

      it("should properly update the underlying and wrapped token units", async () => {
        await subject();

        const positions = await ckToken.getPositions();
        const [receivedWrappedPosition, receivedUnderlyingPosition] = positions;

        expect(positions.length).to.eq(2);
        expect(receivedWrappedPosition.component).to.eq(subjectWrappedToken);
        expect(receivedWrappedPosition.unit).to.eq(ether(0.5));

        expect(receivedUnderlyingPosition.component).to.eq(subjectUnderlyingToken);
        expect(receivedUnderlyingPosition.unit).to.eq(ether(0.5));
      });

      it("emits the correct ComponentUnwrapped event", async () => {
        await expect(subject()).to.emit(wrapModule, "ComponentUnwrapped").withArgs(
          ckToken.address,
          subjectUnderlyingToken,
          subjectWrappedToken,
          preciseMul(subjectWrappedTokenUnits, ckTokensIssued),
          preciseMul(ckTokensIssued, wrappedQuantity.sub(subjectWrappedTokenUnits)),
          subjectIntegrationName
        );
      });

      describe("when the integration ID is invalid", async () => {
        beforeEach(async () => {
          subjectIntegrationName = "INVALID_NAME";
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Must be valid adapter");
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
          const newCKToken = await setup.createCKToken(
            [setup.weth.address],
            [ether(1)],
            [setup.issuanceModule.address, wrapModule.address]
          );

          subjectCKToken = newCKToken.address;
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Must be a valid and initialized CKToken");
        });
      });

      describe("when the subjectComponent is not a Default Position", async () => {
        beforeEach(async () => {
          subjectWrappedToken = await getRandomAddress();
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Target default position must be component");
        });
      });

      describe("when the units is greater than on the position", async () => {
        beforeEach(async () => {
          subjectWrappedTokenUnits = ether(100);
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Unit cant be greater than existing");
        });
      });

      describe("when the underlying units is 0", async () => {
        beforeEach(async () => {
          subjectWrappedTokenUnits = ZERO;
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Target position units must be > 0");
        });
      });
    });

    describe("#unwrapWithEther", async () => {
      let subjectCKToken: Address;
      let subjectWrappedToken: Address;
      let subjectWrappedTokenUnits: BigNumber;
      let subjectIntegrationName: string;
      let subjectCaller: Account;

      let wrappedQuantity: BigNumber;

      beforeEach(async () => {
        subjectCKToken = ckToken.address;
        subjectWrappedToken = wrapAdapterMock.address;
        subjectWrappedTokenUnits = ether(0.5);
        subjectIntegrationName = wrapAdapterMockIntegrationName;
        subjectCaller = owner;

        wrappedQuantity = ether(1);

        await wrapModule.wrapWithEther(
          subjectCKToken,
          subjectWrappedToken,
          wrappedQuantity,
          subjectIntegrationName,
        );
      });

      async function subject(): Promise<any> {
        return wrapModule.connect(subjectCaller.wallet).unwrapWithEther(
          subjectCKToken,
          subjectWrappedToken,
          subjectWrappedTokenUnits,
          subjectIntegrationName,
        );
      }

      it("should burn the correct wrapped asset to the CKToken", async () => {
        await subject();
        const newWrappedBalance = await wrapAdapterMock.balanceOf(ckToken.address);
        const expectedTokenBalance = preciseMul(ckTokensIssued, wrappedQuantity.sub(subjectWrappedTokenUnits));
        expect(newWrappedBalance).to.eq(expectedTokenBalance);
      });

      it("should properly update the underlying and wrapped token units", async () => {
        await subject();

        const positions = await ckToken.getPositions();
        const [receivedWrappedPosition, receivedUnderlyingPosition] = positions;

        expect(positions.length).to.eq(2);
        expect(receivedWrappedPosition.component).to.eq(subjectWrappedToken);
        expect(receivedWrappedPosition.unit).to.eq(ether(0.5));

        expect(receivedUnderlyingPosition.component).to.eq(setup.weth.address);
        expect(receivedUnderlyingPosition.unit).to.eq(ether(0.5));
      });

      it("should have sent the correct quantity of ETH to the CKToken", async () => {
        const provider = getProvider();
        const preEthBalance = await provider.getBalance(wrapAdapterMock.address);

        await subject();

        const postEthBalance = await provider.getBalance(wrapAdapterMock.address);
        expect(postEthBalance).to.eq(preEthBalance.sub(preciseMul(subjectWrappedTokenUnits, ckTokensIssued)));
      });

      it("emits the correct ComponentUnwrapped event", async () => {
        await expect(subject()).to.emit(wrapModule, "ComponentUnwrapped").withArgs(
          ckToken.address,
          setup.weth.address,
          subjectWrappedToken,
          preciseMul(subjectWrappedTokenUnits, ckTokensIssued),
          preciseMul(ckTokensIssued, wrappedQuantity.sub(subjectWrappedTokenUnits)),
          subjectIntegrationName
        );
      });

      describe("when the integration ID is invalid", async () => {
        beforeEach(async () => {
          subjectIntegrationName = "INVALID_NAME";
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Must be valid adapter");
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
          const newCKToken = await setup.createCKToken(
            [setup.weth.address],
            [ether(1)],
            [setup.issuanceModule.address, wrapModule.address]
          );

          subjectCKToken = newCKToken.address;
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Must be a valid and initialized CKToken");
        });
      });

      describe("when the subjectComponent is not a Default Position", async () => {
        beforeEach(async () => {
          subjectWrappedToken = await getRandomAddress();
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Target default position must be component");
        });
      });

      describe("when the units is greater than on the position", async () => {
        beforeEach(async () => {
          subjectWrappedTokenUnits = ether(100);
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Unit cant be greater than existing");
        });
      });

      describe("when the underlying units is 0", async () => {
        beforeEach(async () => {
          subjectWrappedTokenUnits = ZERO;
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Target position units must be > 0");
        });
      });
    });
  });
});
