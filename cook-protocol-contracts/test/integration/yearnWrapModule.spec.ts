import "module-alias/register";
import { BigNumber } from "@ethersproject/bignumber";

import { Address } from "@utils/types";
import { Account } from "@utils/test/types";
import { ADDRESS_ZERO } from "@utils/constants";
import { YearnWrapAdapter, CKToken, WrapModule } from "@utils/contracts";
import DeployHelper from "@utils/deploys";
import {
  ether,
  preciseMul,
} from "@utils/index";
import {
  getAccounts,
  getWaffleExpect,
  getSystemFixture,
  getYearnFixture,
  addSnapshotBeforeRestoreAfterEach,
} from "@utils/test/index";
import { YearnFixture, SystemFixture } from "@utils/fixtures";
import { Vault } from "@utils/contracts/yearn";


const expect = getWaffleExpect();

describe("yearnWrapModule", () => {
  let owner: Account;
  let deployer: DeployHelper;
  let setup: SystemFixture;

  let yearnSetup: YearnFixture;
  let daiVault: Vault;

  let wrapModule: WrapModule;
  let yearnWrapAdapter: YearnWrapAdapter;

  const yearnWrapAdapterIntegrationName: string = "YEARN_WRAPPER";

  before(async () => {
    [
      owner,
    ] = await getAccounts();

    // System setup
    deployer = new DeployHelper(owner.wallet);
    setup = getSystemFixture(owner.address);
    await setup.initialize();

    // Yearn setup
    yearnSetup = getYearnFixture(owner.address);
    await yearnSetup.initialize();

    daiVault =  await yearnSetup.createAndEnableVaultWithStrategyMock(
      setup.dai.address, owner.address, owner.address, owner.address, "daiMockStrategy", "yvDAI", ether(100)
    );

    // WrapModule setup
    wrapModule = await deployer.modules.deployWrapModule(setup.controller.address, setup.weth.address);
    await setup.controller.addModule(wrapModule.address);

    // YearnWrapAdapter setup
    yearnWrapAdapter = await deployer.adapters.deployYearnWrapAdapter();
    await setup.integrationRegistry.addIntegration(wrapModule.address, yearnWrapAdapterIntegrationName, yearnWrapAdapter.address);
  });

  addSnapshotBeforeRestoreAfterEach();

  context("when a CKToken has been deployed and issued", async () => {
    let ckToken: CKToken;
    let ckTokensIssued: BigNumber;

    before(async () => {
      ckToken = await setup.createCKToken(
        [setup.dai.address],
        [ether(1)],
        [setup.issuanceModule.address, wrapModule.address]
      );

      // Initialize modules
      await setup.issuanceModule.initialize(ckToken.address, ADDRESS_ZERO);
      await wrapModule.initialize(ckToken.address);

      // Issue some CKs
      ckTokensIssued = ether(10);
      const underlyingRequired = ckTokensIssued;
      await setup.dai.approve(setup.issuanceModule.address, underlyingRequired);
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
        subjectUnderlyingToken = setup.dai.address;
        subjectWrappedToken = daiVault.address;
        subjectUnderlyingUnits = ether(1);
        subjectIntegrationName = yearnWrapAdapterIntegrationName;
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

      it("should reduce the underlying quantity and mint the wrapped asset to the CKToken", async () => {
        const previousUnderlyingBalance = await setup.dai.balanceOf(ckToken.address);
        const previousWrappedBalance = await daiVault.balanceOf(ckToken.address);

        await subject();

        const underlyingBalance = await setup.dai.balanceOf(ckToken.address);
        const wrappedBalance = await daiVault.balanceOf(ckToken.address);

        const expectedUnderlyingBalance = previousUnderlyingBalance.sub(ckTokensIssued);
        expect(underlyingBalance).to.eq(expectedUnderlyingBalance);

        const expectedWrappedBalance = previousWrappedBalance.add(ckTokensIssued);
        expect(wrappedBalance).to.eq(expectedWrappedBalance);
      });

    });

    describe("#unwrap", () => {
      let subjectCKToken: Address;
      let subjectUnderlyingToken: Address;
      let subjectWrappedToken: Address;
      let subjectWrappedTokenUnits: BigNumber;
      let subjectIntegrationName: string;
      let subjectCaller: Account;

      let wrappedQuantity: BigNumber;

      beforeEach(async () => {
        subjectCKToken = ckToken.address;
        subjectUnderlyingToken = setup.dai.address;
        subjectWrappedToken = daiVault.address;
        subjectWrappedTokenUnits = ether(0.5);
        subjectIntegrationName = yearnWrapAdapterIntegrationName;
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
          {
            gasLimit: 5000000,
          }
        );
      }

      it("should burn the wrapped asset to the CKToken and increase the underlying quantity", async () => {
        const previousUnderlyingBalance = await setup.dai.balanceOf(ckToken.address);
        const previousWrappedBalance = await daiVault.balanceOf(ckToken.address);

        await subject();

        const underlyingBalance = await setup.dai.balanceOf(ckToken.address);
        const wrappedBalance = await daiVault.balanceOf(ckToken.address);

        const delta = preciseMul(ckTokensIssued, wrappedQuantity.sub(subjectWrappedTokenUnits));

        const expectedUnderlyingBalance = previousUnderlyingBalance.add(delta);
        expect(underlyingBalance).to.eq(expectedUnderlyingBalance);

        const expectedWrappedBalance = previousWrappedBalance.sub(delta);
        expect(wrappedBalance).to.eq(expectedWrappedBalance);
      });

      describe("when it is an invalid vault - underlying token", async () => {
        beforeEach(async () => {
            subjectUnderlyingToken = setup.usdc.address;
        });

        it("should revert as it the vault holds a different underlying token", async () => {
          await expect(subject()).to.be.revertedWith("Must be a valid token pair");
        });
      });

    });
  });
});
