import "module-alias/register";
import { BigNumber } from "@ethersproject/bignumber";

import { Address } from "@utils/types";
import { Account } from "@utils/test/types";
import { ADDRESS_ZERO } from "@utils/constants";
import { AaveMigrationWrapAdapter, CKToken, WrapModule } from "@utils/contracts";
import DeployHelper from "@utils/deploys";
import {
  ether,
} from "@utils/index";
import {
  addSnapshotBeforeRestoreAfterEach,
  getAccounts,
  getWaffleExpect,
  getSystemFixture,
  getAaveFixture,
} from "@utils/test/index";
import { AaveFixture, SystemFixture } from "@utils/fixtures";

const expect = getWaffleExpect();

describe("AaveMigrationWrapModule", () => {
  let owner: Account;
  let deployer: DeployHelper;
  let setup: SystemFixture;

  let aaveSetup: AaveFixture;

  let wrapModule: WrapModule;
  let aaveMigrationWrapAdapter: AaveMigrationWrapAdapter;

  const aaveMigrationWrapAdapterIntegrationName: string = "AAVE_MIGRATION_WRAPPER";

  before(async () => {
    [
      owner,
    ] = await getAccounts();

    // System setup
    deployer = new DeployHelper(owner.wallet);
    setup = getSystemFixture(owner.address);
    await setup.initialize();

    // Aave setup
    aaveSetup = getAaveFixture(owner.address);
    await aaveSetup.initialize();

    // WrapModule setup
    wrapModule = await deployer.modules.deployWrapModule(setup.controller.address, setup.weth.address);
    await setup.controller.addModule(wrapModule.address);

    // AaveMigrationWrapAdapter setup
    aaveMigrationWrapAdapter = await deployer.adapters.deployAaveMigrationWrapAdapter(
      aaveSetup.lendToAaveMigrator.address,
      aaveSetup.lendToken.address,
      aaveSetup.aaveToken.address
    );

    await setup.integrationRegistry.addIntegration(wrapModule.address, aaveMigrationWrapAdapterIntegrationName, aaveMigrationWrapAdapter.address);
  });

  addSnapshotBeforeRestoreAfterEach();

  context("when a CKToken has been deployed and issued", async () => {
    let ckToken: CKToken;
    let ckTokensIssued: BigNumber;

    before(async () => {
      ckToken = await setup.createCKToken(
        [aaveSetup.lendToken.address],
        [ether(1)],
        [setup.issuanceModule.address, wrapModule.address]
      );

      // Initialize modules
      await setup.issuanceModule.initialize(ckToken.address, ADDRESS_ZERO);
      await wrapModule.initialize(ckToken.address);

      // Issue some CKs
      ckTokensIssued = ether(10);
      const underlyingRequired = ckTokensIssued;
      await aaveSetup.lendToken.approve(setup.issuanceModule.address, underlyingRequired);

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
        subjectUnderlyingToken = aaveSetup.lendToken.address;
        subjectWrappedToken = aaveSetup.aaveToken.address;
        subjectUnderlyingUnits = ether(1);
        subjectIntegrationName = aaveMigrationWrapAdapterIntegrationName;
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
        const previousUnderlyingBalance = await aaveSetup.lendToken.balanceOf(ckToken.address);
        const previousWrappedBalance = await aaveSetup.aaveToken.balanceOf(ckToken.address);

        await subject();

        const underlyingBalance = await aaveSetup.lendToken.balanceOf(ckToken.address);
        const wrappedBalance = await aaveSetup.aaveToken.balanceOf(ckToken.address);

        const expectedUnderlyingBalance = previousUnderlyingBalance.sub(ckTokensIssued);
        expect(underlyingBalance).to.eq(expectedUnderlyingBalance);

        const expectedWrappedBalance = previousWrappedBalance.add(ckTokensIssued.div(aaveSetup.aaveExchangeRatio));
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
        subjectUnderlyingToken = aaveSetup.lendToken.address;
        subjectWrappedToken = aaveSetup.aaveToken.address;
        subjectWrappedTokenUnits = ether(0.01);
        subjectIntegrationName = aaveMigrationWrapAdapterIntegrationName;
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

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("AAVE migration cannot be reversed");
      });
    });
  });
});
