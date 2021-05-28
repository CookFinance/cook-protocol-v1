import "module-alias/register";
import { BigNumber } from "@ethersproject/bignumber";

import { Address } from "@utils/types";
import { Account } from "@utils/test/types";
import { ADDRESS_ZERO } from "@utils/constants";
import { AaveWrapAdapter, CKToken, WrapModule } from "@utils/contracts";
import DeployHelper from "@utils/deploys";
import {
  ether,
  preciseMul,
} from "@utils/index";
import {
  getAccounts,
  getWaffleExpect,
  getSystemFixture,
  getAaveFixture,
  addSnapshotBeforeRestoreAfterEach,
} from "@utils/test/index";
import { AaveFixture, SystemFixture } from "@utils/fixtures";
import { AToken } from "@typechain/AToken";

const expect = getWaffleExpect();

describe("aaveWrapModule", () => {
  let owner: Account;
  let deployer: DeployHelper;
  let setup: SystemFixture;

  let aaveSetup: AaveFixture;
  let aDai: AToken;

  let wrapModule: WrapModule;
  let aaveWrapAdapter: AaveWrapAdapter;

  const aaveWrapAdapterIntegrationName: string = "AAVE_WRAPPER";

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
    aDai = await aaveSetup.deployAToken(setup.dai.address, await setup.dai.decimals());

    // WrapModule setup
    wrapModule = await deployer.modules.deployWrapModule(setup.controller.address, setup.weth.address);
    await setup.controller.addModule(wrapModule.address);

    // AaveWrapAdapter setup
    aaveWrapAdapter = await deployer.adapters.deployAaveWrapAdapter(aaveSetup.lendingPool.address);
    await setup.integrationRegistry.addIntegration(wrapModule.address, aaveWrapAdapterIntegrationName, aaveWrapAdapter.address);
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
        subjectWrappedToken = aDai.address;
        subjectUnderlyingUnits = ether(1);
        subjectIntegrationName = aaveWrapAdapterIntegrationName;
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
        const previousWrappedBalance = await aDai.balanceOf(ckToken.address);

        await subject();

        const underlyingBalance = await setup.dai.balanceOf(ckToken.address);
        const wrappedBalance = await aDai.balanceOf(ckToken.address);

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
        subjectWrappedToken = aDai.address;
        subjectWrappedTokenUnits = ether(0.5);
        subjectIntegrationName = aaveWrapAdapterIntegrationName;
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
        const previousWrappedBalance = await aDai.balanceOf(ckToken.address);

        await subject();

        const underlyingBalance = await setup.dai.balanceOf(ckToken.address);
        const wrappedBalance = await aDai.balanceOf(ckToken.address);

        const delta = preciseMul(ckTokensIssued, wrappedQuantity.sub(subjectWrappedTokenUnits));

        const expectedUnderlyingBalance = previousUnderlyingBalance.add(delta);
        expect(underlyingBalance).to.eq(expectedUnderlyingBalance);

        const expectedWrappedBalance = previousWrappedBalance.sub(delta);
        expect(wrappedBalance).to.eq(expectedWrappedBalance);
      });
    });
  });
});
