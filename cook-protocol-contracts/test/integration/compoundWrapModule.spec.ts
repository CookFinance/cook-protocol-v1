import "module-alias/register";
import { BigNumber } from "@ethersproject/bignumber";

import { Address } from "@utils/types";
import { Account } from "@utils/test/types";
import { ADDRESS_ZERO } from "@utils/constants";
import { CKToken, WrapModule } from "@utils/contracts";
import { CERc20 } from "@utils/contracts/compound";
import DeployHelper from "@utils/deploys";
import {
  ether,
  preciseMul,
  preciseDiv
} from "@utils/index";
import {
  getAccounts,
  getWaffleExpect,
  getSystemFixture,
  getCompoundFixture,
  addSnapshotBeforeRestoreAfterEach,
} from "@utils/test/index";
import { CompoundFixture, SystemFixture } from "@utils/fixtures";

const expect = getWaffleExpect();

describe("compoundWrapModule", () => {
  let owner: Account;
  let deployer: DeployHelper;
  let setup: SystemFixture;

  let compoundSetup: CompoundFixture;
  let cDai: CERc20;
  let exchangeRate: BigNumber;

  let wrapModule: WrapModule;

  const compoundWrapAdapterIntegrationName: string = "COMPOUND_WRAPPER";

  before(async () => {
    [
      owner,
    ] = await getAccounts();

    // System setup
    deployer = new DeployHelper(owner.wallet);
    setup = getSystemFixture(owner.address);
    await setup.initialize();

    // Compound setup
    compoundSetup = getCompoundFixture(owner.address);
    await compoundSetup.initialize();

    exchangeRate = ether(0.5);
    cDai = await compoundSetup.createAndEnableCToken(
      setup.dai.address,
      exchangeRate,
      compoundSetup.comptroller.address,
      compoundSetup.interestRateModel.address,
      "Compound DAI",
      "cDAI",
      8,
      ether(0.75), // 75% collateral factor
      ether(1)
    );


    // WrapModule setup
    wrapModule = await deployer.modules.deployWrapModule(setup.controller.address, setup.weth.address);
    await setup.controller.addModule(wrapModule.address);

    // compoundWrapAdapter setup
    const compoundLibrary = await deployer.libraries.deployCompound();
    const compoundWrapAdapter = await deployer.adapters.deployCompoundWrapAdapter(
      "contracts/protocol/integration/lib/Compound.sol:Compound",
      compoundLibrary.address
    );
    await setup.integrationRegistry.addIntegration(wrapModule.address, compoundWrapAdapterIntegrationName, compoundWrapAdapter.address);
  });

  addSnapshotBeforeRestoreAfterEach();

  context("when a CKToken has been deployed and issued", async () => {
    let ckToken: CKToken;
    let ckTokensIssued: BigNumber;

    beforeEach(async () => {
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
        subjectWrappedToken = cDai.address;
        subjectUnderlyingUnits = ether(1);
        subjectIntegrationName = compoundWrapAdapterIntegrationName;
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

        await subject();

        const underlyingBalance = await setup.dai.balanceOf(ckToken.address);
        const wrappedBalance = await cDai.balanceOf(ckToken.address);
        const expectedUnderlyingBalance = previousUnderlyingBalance.sub(ckTokensIssued);

        expect(underlyingBalance).to.eq(expectedUnderlyingBalance);

        const expectedWrappedBalance = preciseDiv(previousUnderlyingBalance, exchangeRate);

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
        subjectWrappedToken = cDai.address;
        subjectWrappedTokenUnits = BigNumber.from("5000000000");  // ctokens have 8 decimals
        subjectIntegrationName = compoundWrapAdapterIntegrationName;
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
          subjectIntegrationName
        );
      }

      it("should burn the wrapped asset to the CKToken and increase the underlying quantity", async () => {
        const previousWrappedBalance = await cDai.balanceOf(ckToken.address);

        await subject();

        const underlyingBalance = await setup.dai.balanceOf(ckToken.address);
        const wrappedBalance = await cDai.balanceOf(ckToken.address);
        const delta = preciseMul(ckTokensIssued, subjectWrappedTokenUnits);
        const expectedUnderlyingBalance = preciseMul(delta, exchangeRate);

        expect(underlyingBalance).to.eq(expectedUnderlyingBalance);

        const expectedWrappedBalance = previousWrappedBalance.sub(delta);

        expect(wrappedBalance).to.eq(expectedWrappedBalance);
      });
    });
  });
});
