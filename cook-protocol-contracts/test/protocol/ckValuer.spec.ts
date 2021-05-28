import "module-alias/register";
import { BigNumber } from "@ethersproject/bignumber";
import { CKToken, CKValuer } from "@utils/contracts";
import DeployHelper from "@utils/deploys";
import {
  ether,
  usdc,
  preciseDiv,
  preciseMul,
} from "@utils/index";
import {
  getSystemFixture,
  getWaffleExpect,
  getAccounts,
  addSnapshotBeforeRestoreAfterEach,
} from "@utils/test/index";

import { Address } from "@utils/types";
import { Account } from "@utils/test/types";
import { SystemFixture } from "@utils/fixtures";
import { ADDRESS_ZERO } from "@utils/constants";

const expect = getWaffleExpect();

describe("CKValuer", () => {
  let owner: Account, moduleOne: Account;
  let ckToken: CKToken;
  let deployer: DeployHelper;
  let setup: SystemFixture;

  let components: Address[];
  let units: BigNumber[];
  let baseUnits: BigNumber[];
  let modules: Address[];

  beforeEach(async () => {
    [owner, moduleOne] = await getAccounts();

    deployer = new DeployHelper(owner.wallet);
    setup = getSystemFixture(owner.address);
    await setup.initialize();

    await setup.controller.addModule(moduleOne.address);

    components = [setup.usdc.address, setup.weth.address];
    // 100 USDC at $1 and 1 WETH at $230
    units = [usdc(100), ether(1)];
    // Base units of USDC and WETH
    baseUnits = [usdc(1), ether(1)];

    modules = [moduleOne.address];

    ckToken = await setup.createCKToken(components, units, modules);

    ckToken = ckToken.connect(moduleOne.wallet);
    await ckToken.initializeModule();
  });

  addSnapshotBeforeRestoreAfterEach();

  describe("#constructor", async () => {
    let subjectController: Address;

    beforeEach(async () => {
      subjectController = setup.controller.address;
    });

    async function subject(): Promise<CKValuer> {
      return deployer.core.deployCKValuer(subjectController);
    }

    it("should have the correct controller address", async () => {
      const ckValuer = await subject();

      const actualController = await ckValuer.controller();
      expect(actualController).to.eq(subjectController);
    });
  });

  describe("#calculateCKTokenValuation", async () => {
    let subjectCKToken: Address;
    let subjectQuoteAsset: Address;

    beforeEach(async () => {
      subjectCKToken = ckToken.address;
      subjectQuoteAsset = setup.usdc.address;
    });

    async function subject(): Promise<any> {
      ckToken = ckToken.connect(owner.wallet);
      return setup.ckValuer.calculateCKTokenValuation(
        subjectCKToken,
        subjectQuoteAsset
      );
    }

    it("should calculate correct CKToken valuation", async () => {
      const ckTokenValuation = await subject();

      const normalizedUnitOne = preciseDiv(units[0], baseUnits[0]);
      const normalizedUnitTwo = preciseDiv(units[1], baseUnits[1]);

      const expectedValuation = preciseMul(
        normalizedUnitOne, setup.component2Price
      ).add(preciseMul(
        normalizedUnitTwo, setup.component1Price
      ));
      expect(ckTokenValuation).to.eq(expectedValuation);
    });

    describe("when the quote asset is not the master quote asset", async () => {
      beforeEach(async () => {
        subjectQuoteAsset = setup.weth.address;
      });

      it("should calculate correct CKToken valuation", async () => {
        const ckTokenValuation = await subject();

        const normalizedUnitOne = preciseDiv(units[0], baseUnits[0]);
        const normalizedUnitTwo = preciseDiv(units[1], baseUnits[1]);

        const quoteToMasterQuote = await setup.ETH_USD_Oracle.read();

        const masterQuoteValuation = preciseMul(
          normalizedUnitOne, setup.component2Price
        ).add(preciseMul(
          normalizedUnitTwo, setup.component1Price
        ));
        const expectedValuation = preciseDiv(masterQuoteValuation, quoteToMasterQuote);

        expect(ckTokenValuation).to.eq(expectedValuation);
      });
    });

    describe("when a CK token has an external position", async () => {
      let externalUnits: BigNumber;

      beforeEach(async () => {
        externalUnits = ether(100);
        ckToken = ckToken.connect(moduleOne.wallet);
        await ckToken.addExternalPositionModule(setup.usdc.address, ADDRESS_ZERO);
        await ckToken.editExternalPositionUnit(setup.usdc.address, ADDRESS_ZERO, externalUnits);
      });

      it("should calculate correct CKToken valuation", async () => {
        const ckTokenValuation = await subject();

        const expectedValuation = preciseMul(
          preciseDiv(units[0].add(externalUnits), baseUnits[0]), setup.component4Price
        ).add(preciseMul(
          preciseDiv(units[1], baseUnits[1]), setup.component1Price
        ));
        expect(ckTokenValuation).to.eq(expectedValuation);
      });
    });

    describe("when a CK token has a negative external position", async () => {
      let externalUnits: BigNumber;

      beforeEach(async () => {
        // Edit external DAI units to be negative
        externalUnits = usdc(-10);
        ckToken = ckToken.connect(moduleOne.wallet);
        await ckToken.addExternalPositionModule(setup.usdc.address, ADDRESS_ZERO);
        await ckToken.editExternalPositionUnit(setup.usdc.address, ADDRESS_ZERO, externalUnits);
      });

      it("should calculate correct CKToken valuation", async () => {
        const ckTokenValuation = await subject();
        const expectedValuation = preciseMul(
          preciseDiv(units[0].add(externalUnits), baseUnits[0]), setup.component4Price
        ).add(preciseMul(
          preciseDiv(units[1], baseUnits[1]), setup.component1Price
        ));
        expect(ckTokenValuation).to.eq(expectedValuation);
      });
    });

    describe("when valuation is negative", async () => {
      let externalUnits: BigNumber;

      beforeEach(async () => {
        // Edit external DAI units to be greatly negative
        externalUnits = ether(-500);
        ckToken = ckToken.connect(moduleOne.wallet);
        await ckToken.addExternalPositionModule(setup.usdc.address, ADDRESS_ZERO);
        await ckToken.editExternalPositionUnit(setup.usdc.address, ADDRESS_ZERO, externalUnits);
      });

      it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("SafeCast: value must be positive");
        });
    });
  });
});