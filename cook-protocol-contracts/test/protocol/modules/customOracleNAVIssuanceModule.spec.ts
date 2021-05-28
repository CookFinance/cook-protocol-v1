import "module-alias/register";

import { BigNumber, BigNumberish } from "@ethersproject/bignumber";

import { Address, CustomOracleNAVIssuanceSettings } from "@utils/types";
import { Account } from "@utils/test/types";
import { ONE, TWO, THREE, ZERO, ADDRESS_ZERO } from "@utils/constants";
import {
  ManagerIssuanceHookMock,
  NAVIssuanceHookMock,
  CustomOracleNavIssuanceModule,
  CKToken,
  CustomCKValuerMock,
  ICKValuer
} from "@utils/contracts";
import DeployHelper from "@utils/deploys";
import {
  bitcoin,
  ether,
  getExpectedIssuePositionMultiplier,
  getExpectedIssuePositionUnit,
  getExpectedPostFeeQuantity,
  getExpectedCKTokenIssueQuantity,
  getExpectedReserveRedeemQuantity,
  getExpectedRedeemPositionMultiplier,
  getExpectedRedeemPositionUnit,
  preciseMul,
  usdc,
} from "@utils/index";
import {
  getAccounts,
  getRandomAddress,
  addSnapshotBeforeRestoreAfterEach,
  getRandomAccount,
  getProvider,
  getWaffleExpect,
  getSystemFixture,
} from "@utils/test/index";
import { SystemFixture } from "@utils/fixtures";
import { ERC20__factory } from "../../../typechain/factories/ERC20__factory";

const expect = getWaffleExpect();

describe("CustomOracleNavIssuanceModule", () => {
  let owner: Account;
  let feeRecipient: Account;
  let recipient: Account;
  let deployer: DeployHelper;

  let setup: SystemFixture;
  let customOracleNavIssuanceModule: CustomOracleNavIssuanceModule;

  before(async () => {
    [
      owner,
      feeRecipient,
      recipient,
    ] = await getAccounts();

    deployer = new DeployHelper(owner.wallet);
    setup = getSystemFixture(owner.address);
    await setup.initialize();

    customOracleNavIssuanceModule = await deployer.modules.deployCustomOracleNavIssuanceModule(setup.controller.address, setup.weth.address);
    await setup.controller.addModule(customOracleNavIssuanceModule.address);
  });

  addSnapshotBeforeRestoreAfterEach();

  describe("#constructor", async () => {
    let subjectController: Address;
    let subjectWETH: Address;

    beforeEach(async () => {
      subjectController = setup.controller.address;
      subjectWETH = setup.weth.address;
    });

    async function subject(): Promise<CustomOracleNavIssuanceModule> {
      return deployer.modules.deployCustomOracleNavIssuanceModule(subjectController, subjectWETH);
    }

    it("should set the correct controller", async () => {
      const customOracleNavIssuanceModule = await subject();

      const controller = await customOracleNavIssuanceModule.controller();
      expect(controller).to.eq(subjectController);
    });

    it("should set the correct weth contract", async () => {
      const customOracleNavIssuanceModule = await subject();

      const weth = await customOracleNavIssuanceModule.weth();
      expect(weth).to.eq(subjectWETH);
    });
  });

  describe("#initialize", async () => {
    let ckToken: CKToken;
    let managerIssuanceHook: Address;
    let managerRedemptionHook: Address;
    let reserveAssets: Address[];
    let managerFeeRecipient: Address;
    let managerFees: [BigNumberish, BigNumberish];
    let maxManagerFee: BigNumber;
    let premiumPercentage: BigNumber;
    let maxPremiumPercentage: BigNumber;
    let minCKTokenSupply: BigNumber;
    let ckValuerAddress: Address;

    let subjectNAVIssuanceSettings: CustomOracleNAVIssuanceSettings;
    let subjectCKToken: Address;
    let subjectCaller: Account;

    beforeEach(async () => {
      ckToken = await setup.createCKToken(
        [setup.weth.address],
        [ether(1)],
        [customOracleNavIssuanceModule.address]
      );
      managerIssuanceHook = await getRandomAddress();
      managerRedemptionHook = await getRandomAddress();
      reserveAssets = [setup.usdc.address, setup.weth.address];
      managerFeeRecipient = feeRecipient.address;
      // Set manager issue fee to 0.1% and redeem to 0.2%
      managerFees = [ether(0.001), ether(0.002)];
      // Set max managerFee to 2%
      maxManagerFee = ether(0.02);
      // Set premium to 1%
      premiumPercentage = ether(0.01);
      // Set max premium to 10%
      maxPremiumPercentage = ether(0.1);
      // Set min CKToken supply to 100 units
      minCKTokenSupply = ether(100);

      subjectCKToken = ckToken.address;
      subjectNAVIssuanceSettings = {
        managerIssuanceHook,
        managerRedemptionHook,
        ckValuer: ckValuerAddress,
        reserveAssets,
        feeRecipient: managerFeeRecipient,
        managerFees,
        maxManagerFee,
        premiumPercentage,
        maxPremiumPercentage,
        minCKTokenSupply,
      } as CustomOracleNAVIssuanceSettings;
      subjectCaller = owner;
    });

    async function subject(): Promise<any> {
      return customOracleNavIssuanceModule.connect(subjectCaller.wallet).initialize(
        subjectCKToken,
        subjectNAVIssuanceSettings
      );
    }
    context("when using a custom valuer", () => {
      before(async () => {
        const ckValuerMock = await deployer.mocks.deployCustomCKValuerMock();
        ckValuerAddress = ckValuerMock.address;
      });
      it("the ck valuer address should be present in the settings", async () => {
        await subject();
        const navIssuanceSettings: any = await customOracleNavIssuanceModule.navIssuanceSettings(subjectCKToken);
        expect(navIssuanceSettings.ckValuer).to.eq(ckValuerAddress);
      });
    });

    context("when using the default valuer", () => {
      before(async() => {ckValuerAddress = ADDRESS_ZERO; });
      it("should set the correct NAV issuance settings", async () => {
        await subject();

        const navIssuanceSettings: any = await customOracleNavIssuanceModule.navIssuanceSettings(subjectCKToken);
        const retrievedReserveAssets = await customOracleNavIssuanceModule.getReserveAssets(subjectCKToken);
        const managerIssueFee = await customOracleNavIssuanceModule.getManagerFee(subjectCKToken, ZERO);
        const managerRedeemFee = await customOracleNavIssuanceModule.getManagerFee(subjectCKToken, ONE);

        expect(JSON.stringify(retrievedReserveAssets)).to.eq(JSON.stringify(reserveAssets));
        expect(navIssuanceSettings.managerIssuanceHook).to.eq(managerIssuanceHook);
        expect(navIssuanceSettings.managerRedemptionHook).to.eq(managerRedemptionHook);
        expect(navIssuanceSettings.ckValuer).to.eq(ADDRESS_ZERO);
        expect(navIssuanceSettings.feeRecipient).to.eq(managerFeeRecipient);
        expect(managerIssueFee).to.eq(managerFees[0]);
        expect(managerRedeemFee).to.eq(managerFees[1]);
        expect(navIssuanceSettings.maxManagerFee).to.eq(maxManagerFee);
        expect(navIssuanceSettings.premiumPercentage).to.eq(premiumPercentage);
        expect(navIssuanceSettings.maxPremiumPercentage).to.eq(maxPremiumPercentage);
        expect(navIssuanceSettings.minCKTokenSupply).to.eq(minCKTokenSupply);
      });

      it("should enable the Module on the CKToken", async () => {
        await subject();

        const isModuleEnabled = await ckToken.isInitializedModule(customOracleNavIssuanceModule.address);
        expect(isModuleEnabled).to.eq(true);
      });

      it("should properly set reserve assets mapping", async () => {
        await subject();

        const isUsdcReserveAsset = await customOracleNavIssuanceModule.isReserveAsset(subjectCKToken, setup.usdc.address);
        const isWethReserveAsset = await customOracleNavIssuanceModule.isReserveAsset(subjectCKToken, setup.weth.address);
        expect(isUsdcReserveAsset).to.eq(true);
        expect(isWethReserveAsset).to.eq(true);
      });
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

        const customOracleNavIssuanceModuleNotPendingCKToken = await setup.createCKToken(
          [setup.weth.address],
          [ether(1)],
          [newModule]
        );

        subjectCKToken = customOracleNavIssuanceModuleNotPendingCKToken.address;
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
          [customOracleNavIssuanceModule.address]
        );

        subjectCKToken = nonEnabledCKToken.address;
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Must be controller-enabled CKToken");
      });
    });

    describe("when no reserve assets are specified", async () => {
      beforeEach(async () => {
        subjectNAVIssuanceSettings.reserveAssets = [];
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Reserve assets must be greater than 0");
      });
    });

    describe("when reserve asset is duplicated", async () => {
      beforeEach(async () => {
        subjectNAVIssuanceSettings.reserveAssets = [setup.weth.address, setup.weth.address];
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Reserve assets must be unique");
      });
    });

    describe("when manager issue fee is greater than max", async () => {
      beforeEach(async () => {
        // Set to 100%
        subjectNAVIssuanceSettings.managerFees = [ether(1), ether(0.002)];
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Manager issue fee must be less than max");
      });
    });

    describe("when manager redeem fee is greater than max", async () => {
      beforeEach(async () => {
        // Set to 100%
        subjectNAVIssuanceSettings.managerFees = [ether(0.001), ether(1)];
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Manager redeem fee must be less than max");
      });
    });

    describe("when max manager fee is greater than 100%", async () => {
      beforeEach(async () => {
        // Set to 200%
        subjectNAVIssuanceSettings.maxManagerFee = ether(2);
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Max manager fee must be less than 100%");
      });
    });

    describe("when premium is greater than max", async () => {
      beforeEach(async () => {
        // Set to 100%
        subjectNAVIssuanceSettings.premiumPercentage = ether(1);
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Premium must be less than max");
      });
    });

    describe("when premium is greater than 100%", async () => {
      beforeEach(async () => {
        // Set to 100%
        subjectNAVIssuanceSettings.maxPremiumPercentage = ether(2);
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Max premium percentage must be less than 100%");
      });
    });

    describe("when feeRecipient is zero address", async () => {
      beforeEach(async () => {
        subjectNAVIssuanceSettings.feeRecipient = ADDRESS_ZERO;
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Fee Recipient must be non-zero address.");
      });
    });

    describe("when min CKToken supply is 0", async () => {
      beforeEach(async () => {
        subjectNAVIssuanceSettings.minCKTokenSupply = ZERO;
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Min CKToken supply must be greater than 0");
      });
    });
  });

  describe("#removeModule", async () => {
    let ckToken: CKToken;

    let subjectCKToken: Address;
    let subjectModule: Address;

    beforeEach(async () => {
      ckToken = await setup.createCKToken(
        [setup.weth.address],
        [ether(1)],
        [customOracleNavIssuanceModule.address]
      );
      // Set premium to 1%
      const managerIssuanceHook = await getRandomAddress();
      const managerRedemptionHook = await getRandomAddress();
      const reserveAssets = [setup.usdc.address, setup.weth.address];
      const managerFeeRecipient = feeRecipient.address;
      // Set manager issue fee to 0.1% and redeem to 0.2%
      const managerFees = [ether(0.001), ether(0.002)] as [BigNumberish, BigNumberish];
      // Set max managerFee to 2%
      const maxManagerFee = ether(0.02);
      // Set premium to 1%
      const premiumPercentage = ether(0.01);
      // Set max premium to 10%
      const maxPremiumPercentage = ether(0.1);
      // Set min CKToken supply required
      const minCKTokenSupply = ether(1);

      subjectCKToken = ckToken.address;
      await customOracleNavIssuanceModule.connect(owner.wallet).initialize(
        ckToken.address,
        {
          managerIssuanceHook,
          managerRedemptionHook,
          ckValuer: ADDRESS_ZERO,
          reserveAssets,
          feeRecipient: managerFeeRecipient,
          managerFees,
          maxManagerFee,
          premiumPercentage,
          maxPremiumPercentage,
          minCKTokenSupply,
        }
      );

      subjectModule = customOracleNavIssuanceModule.address;
    });

    async function subject(): Promise<any> {
      return ckToken.removeModule(subjectModule);
    }

    it("should delete reserve assets state", async () => {
      await subject();

      const isUsdcReserveAsset = await customOracleNavIssuanceModule.isReserveAsset(ckToken.address, setup.usdc.address);
      const isWethReserveAsset = await customOracleNavIssuanceModule.isReserveAsset(ckToken.address, setup.weth.address);
      expect(isUsdcReserveAsset).to.be.false;
      expect(isWethReserveAsset).to.be.false;
    });

    it("should delete the NAV issuance settings", async () => {
      await subject();

      const navIssuanceSettings: any = await customOracleNavIssuanceModule.navIssuanceSettings(subjectCKToken);
      const retrievedReserveAssets = await customOracleNavIssuanceModule.getReserveAssets(subjectCKToken);
      const managerIssueFee = await customOracleNavIssuanceModule.getManagerFee(subjectCKToken, ZERO);
      const managerRedeemFee = await customOracleNavIssuanceModule.getManagerFee(subjectCKToken, ONE);

      expect(retrievedReserveAssets).to.be.empty;
      expect(navIssuanceSettings.managerIssuanceHook).to.eq(ADDRESS_ZERO);
      expect(navIssuanceSettings.managerRedemptionHook).to.eq(ADDRESS_ZERO);
      expect(navIssuanceSettings.feeRecipient).to.eq(ADDRESS_ZERO);
      expect(managerIssueFee).to.eq(ZERO);
      expect(managerRedeemFee).to.eq(ZERO);
      expect(navIssuanceSettings.maxManagerFee).to.eq(ZERO);
      expect(navIssuanceSettings.premiumPercentage).to.eq(ZERO);
      expect(navIssuanceSettings.maxPremiumPercentage).to.eq(ZERO);
      expect(navIssuanceSettings.minCKTokenSupply).to.eq(ZERO);
    });
  });

  describe("#getReserveAssets", async () => {
    let reserveAssets: Address[];
    let subjectCKToken: Address;

    beforeEach(async () => {
      const ckToken = await setup.createCKToken(
        [setup.weth.address],
        [ether(1)],
        [customOracleNavIssuanceModule.address]
      );
      const managerIssuanceHook = await getRandomAddress();
      const managerRedemptionHook = await getRandomAddress();
      reserveAssets = [setup.usdc.address, setup.weth.address];
      const managerFeeRecipient = feeRecipient.address;
      // Set manager issue fee to 0.1% and redeem to 0.2%
      const managerFees = [ether(0.001), ether(0.002)];
      // Set max managerFee to 2%
      const maxManagerFee = ether(0.02);
      // Set premium to 1%
      const premiumPercentage = ether(0.01);
      // Set max premium to 10%
      const maxPremiumPercentage = ether(0.1);
      // Set min CKToken supply to 100 units
      const minCKTokenSupply = ether(100);

      const navIssuanceSettings = {
        managerIssuanceHook,
        managerRedemptionHook,
        ckValuer: ADDRESS_ZERO,
        reserveAssets,
        feeRecipient: managerFeeRecipient,
        managerFees,
        maxManagerFee,
        premiumPercentage,
        maxPremiumPercentage,
        minCKTokenSupply,
      } as CustomOracleNAVIssuanceSettings;

      await customOracleNavIssuanceModule.initialize(
        ckToken.address,
        navIssuanceSettings
      );

      subjectCKToken = ckToken.address;
    });

    async function subject(): Promise<any> {
      return customOracleNavIssuanceModule.getReserveAssets(subjectCKToken);
    }

    it("should return the valid reserve assets", async () => {
      const returnedReserveAssets = await subject();

      expect(JSON.stringify(returnedReserveAssets)).to.eq(JSON.stringify(reserveAssets));
    });
  });

  describe("#getIssuePremium", async () => {
    let premiumPercentage: BigNumber;
    let subjectCKToken: Address;
    let subjectReserveAsset: Address;
    let subjectReserveQuantity: BigNumber;

    beforeEach(async () => {
      const ckToken = await setup.createCKToken(
        [setup.weth.address],
        [ether(1)],
        [customOracleNavIssuanceModule.address]
      );
      const managerIssuanceHook = await getRandomAddress();
      const managerRedemptionHook = await getRandomAddress();
      const reserveAssets = [setup.usdc.address, setup.weth.address];
      const managerFeeRecipient = feeRecipient.address;
      // Set manager issue fee to 0.1% and redeem to 0.2%
      const managerFees = [ether(0.001), ether(0.002)];
      // Set max managerFee to 2%
      const maxManagerFee = ether(0.02);
      // Set premium to 1%
      premiumPercentage = ether(0.01);
      // Set max premium to 10%
      const maxPremiumPercentage = ether(0.1);
      // Set min CKToken supply to 100 units
      const minCKTokenSupply = ether(100);

      const navIssuanceSettings = {
        managerIssuanceHook,
        managerRedemptionHook,
        ckValuer: ADDRESS_ZERO,
        reserveAssets,
        feeRecipient: managerFeeRecipient,
        managerFees,
        maxManagerFee,
        premiumPercentage,
        maxPremiumPercentage,
        minCKTokenSupply,
      } as CustomOracleNAVIssuanceSettings;

      await customOracleNavIssuanceModule.initialize(
        ckToken.address,
        navIssuanceSettings
      );

      subjectCKToken = ckToken.address;
      subjectReserveAsset = await getRandomAddress(); // Unused in CustomOracleNavIssuanceModule V1
      subjectReserveQuantity = ether(1); // Unused in NAVIssuanceModule V1
    });

    async function subject(): Promise<any> {
      return customOracleNavIssuanceModule.getIssuePremium(subjectCKToken, subjectReserveAsset, subjectReserveQuantity);
    }

    it("should return the correct premium", async () => {
      const returnedPremiumPercentage = await subject();

      expect(returnedPremiumPercentage).to.eq(premiumPercentage);
    });
  });

  describe("#getRedeemPremium", async () => {
    let premiumPercentage: BigNumber;
    let subjectCKToken: Address;
    let subjectReserveAsset: Address;
    let subjectCKTokenQuantity: BigNumber;

    beforeEach(async () => {
      const ckToken = await setup.createCKToken(
        [setup.weth.address],
        [ether(1)],
        [customOracleNavIssuanceModule.address]
      );
      const managerIssuanceHook = await getRandomAddress();
      const managerRedemptionHook = await getRandomAddress();
      const reserveAssets = [setup.usdc.address, setup.weth.address];
      const managerFeeRecipient = feeRecipient.address;
      // Set manager issue fee to 0.1% and redeem to 0.2%
      const managerFees = [ether(0.001), ether(0.002)];
      // Set max managerFee to 2%
      const maxManagerFee = ether(0.02);
      // Set premium to 1%
      premiumPercentage = ether(0.01);
      // Set max premium to 10%
      const maxPremiumPercentage = ether(0.1);
      // Set min CKToken supply to 100 units
      const minCKTokenSupply = ether(100);

      const navIssuanceSettings = {
        managerIssuanceHook,
        managerRedemptionHook,
        ckValuer: ADDRESS_ZERO,
        reserveAssets,
        feeRecipient: managerFeeRecipient,
        managerFees,
        maxManagerFee,
        premiumPercentage,
        maxPremiumPercentage,
        minCKTokenSupply,
      } as CustomOracleNAVIssuanceSettings;

      await customOracleNavIssuanceModule.initialize(
        ckToken.address,
        navIssuanceSettings
      );

      subjectCKToken = ckToken.address;
      subjectReserveAsset = await getRandomAddress(); // Unused in CustomOracleNavIssuanceModule V1
      subjectCKTokenQuantity = ether(1); // Unused in NAVIssuanceModule V1
    });

    async function subject(): Promise<any> {
      return customOracleNavIssuanceModule.getRedeemPremium(subjectCKToken, subjectReserveAsset, subjectCKTokenQuantity);
    }

    it("should return the correct premium", async () => {
      const returnedPremiumPercentage = await subject();

      expect(returnedPremiumPercentage).to.eq(premiumPercentage);
    });
  });

  describe("#getManagerFee", async () => {
    let managerFees: BigNumber[];
    let subjectCKToken: Address;
    let subjectFeeIndex: BigNumber;

    beforeEach(async () => {
      const ckToken = await setup.createCKToken(
        [setup.weth.address],
        [ether(1)],
        [customOracleNavIssuanceModule.address]
      );
      const managerIssuanceHook = await getRandomAddress();
      const managerRedemptionHook = await getRandomAddress();
      const reserveAssets = [setup.usdc.address, setup.weth.address];
      const managerFeeRecipient = feeRecipient.address;
      // Set manager issue fee to 0.1% and redeem to 0.2%
      managerFees = [ether(0.001), ether(0.002)];
      // Set max managerFee to 2%
      const maxManagerFee = ether(0.02);
      // Set premium to 1%
      const premiumPercentage = ether(0.01);
      // Set max premium to 10%
      const maxPremiumPercentage = ether(0.1);
      // Set min CKToken supply to 100 units
      const minCKTokenSupply = ether(100);

      const navIssuanceSettings = {
        managerIssuanceHook,
        managerRedemptionHook,
        ckValuer: ADDRESS_ZERO,
        reserveAssets,
        feeRecipient: managerFeeRecipient,
        managerFees,
        maxManagerFee,
        premiumPercentage,
        maxPremiumPercentage,
        minCKTokenSupply,
      } as CustomOracleNAVIssuanceSettings;

      await customOracleNavIssuanceModule.initialize(
        ckToken.address,
        navIssuanceSettings
      );

      subjectCKToken = ckToken.address;
      subjectFeeIndex = ZERO;
    });

    async function subject(): Promise<any> {
      return customOracleNavIssuanceModule.getManagerFee(subjectCKToken, subjectFeeIndex);
    }

    it("should return the manager fee", async () => {
      const returnedManagerFee = await subject();

      expect(returnedManagerFee).to.eq(managerFees[0]);
    });
  });

  describe("#getExpectedCKTokenIssueQuantity", async () => {
    let subjectCKToken: Address;
    let subjectReserveAsset: Address;
    let subjectReserveQuantity: BigNumber;

    let ckToken: CKToken;
    let ckValuerAddress: Address;
    let ckValuerMock: CustomCKValuerMock;
    let managerFees: BigNumber[];
    let protocolDirectFee: BigNumber;
    let premiumPercentage: BigNumber;

    beforeEach(async () => {
      ckToken = await setup.createCKToken(
        [setup.weth.address, setup.usdc.address],
        [ether(1), usdc(1)],
        [customOracleNavIssuanceModule.address, setup.issuanceModule.address]
      );
      const managerIssuanceHook = await getRandomAddress();
      const managerRedemptionHook = await getRandomAddress();
      const reserveAssets = [setup.usdc.address, setup.weth.address];
      const managerFeeRecipient = feeRecipient.address;
      // Set manager issue fee to 0.1% and redeem to 0.2%
      managerFees = [ether(0.001), ether(0.002)];
      // Set max managerFee to 2%
      const maxManagerFee = ether(0.02);
      // Set premium to 1%
      premiumPercentage = ether(0.01);
      // Set max premium to 10%
      const maxPremiumPercentage = ether(0.1);
      // Set min CKToken supply to 100 units
      const minCKTokenSupply = ether(100);

      const navIssuanceSettings = {
        managerIssuanceHook,
        managerRedemptionHook,
        reserveAssets,
        ckValuer: ckValuerAddress,
        feeRecipient: managerFeeRecipient,
        managerFees,
        maxManagerFee,
        premiumPercentage,
        maxPremiumPercentage,
        minCKTokenSupply,
      } as CustomOracleNAVIssuanceSettings;

      await customOracleNavIssuanceModule.initialize(
        ckToken.address,
        navIssuanceSettings
      );
      await setup.weth.approve(setup.controller.address, ether(100));
      await setup.usdc.approve(setup.controller.address, usdc(1000000));
      await setup.issuanceModule.connect(owner.wallet).initialize(ckToken.address, ADDRESS_ZERO);
      await setup.issuanceModule.connect(owner.wallet).issue(ckToken.address, ether(10), owner.address);

      protocolDirectFee = ether(.02);
      await setup.controller.addFee(customOracleNavIssuanceModule.address, TWO, protocolDirectFee);

      const protocolManagerFee = ether(.3);
      await setup.controller.addFee(customOracleNavIssuanceModule.address, ZERO, protocolManagerFee);

      subjectCKToken = ckToken.address;
    });

    async function subject(): Promise<any> {
      return customOracleNavIssuanceModule.getExpectedCKTokenIssueQuantity(subjectCKToken, subjectReserveAsset, subjectReserveQuantity);
    }

    context("with a custom ck valuer", () => {
      const usdcValuation: BigNumber = ether(370);
      const wethValuation: BigNumber = ether(1.85);
      before(async() => {
        ckValuerMock = await deployer.mocks.deployCustomCKValuerMock();
        await ckValuerMock.setValuation(setup.usdc.address, usdcValuation);
        await ckValuerMock.setValuation(setup.weth.address, wethValuation);
        ckValuerAddress = ckValuerMock.address;
      });

      context("when issuing with usdc", () => {
        before(() => {
          subjectReserveAsset = setup.usdc.address;
          subjectReserveQuantity = usdc(370);
        });

        it("then the price from the custom ck valuer is used", async() => {
          const expectedCKTokenIssueQuantity  = await getExpectedCKTokenIssueQuantity(
            ckToken,
            ckValuerMock,
            subjectReserveAsset,
            usdc(1), // usdc base units
            subjectReserveQuantity,
            managerFees[0],
            protocolDirectFee, // Protocol fee percentage
            premiumPercentage
          );
          const returnedCKTokenIssueQuantity = await subject();
          expect(returnedCKTokenIssueQuantity).to.eq(expectedCKTokenIssueQuantity);
        });
      });

      context("when issuing with weth", () => {
        before(() => {
          subjectReserveAsset = setup.weth.address;
          subjectReserveQuantity = ether(1);
        });

        it("then the price from the custom ck valuer is used", async() => {
          const expectedCKTokenIssueQuantity  = await getExpectedCKTokenIssueQuantity(
            ckToken,
            ckValuerMock,
            subjectReserveAsset,
            ether(1), // usdc base units
            subjectReserveQuantity,
            managerFees[0],
            protocolDirectFee, // Protocol fee percentage
            premiumPercentage
          );
          const returnedCKTokenIssueQuantity = await subject();
          expect(returnedCKTokenIssueQuantity).to.eq(expectedCKTokenIssueQuantity);
        });
      });
    });

    context("with the default valuer", () => {
      before(async() => {
        subjectReserveAsset = setup.usdc.address;
        subjectReserveQuantity = ether(1);
        ckValuerAddress = ADDRESS_ZERO;
      });
      it("should return the correct expected Set issue quantity", async () => {

        const expectedCKTokenIssueQuantity = await getExpectedCKTokenIssueQuantity(
          ckToken,
          setup.ckValuer,
          subjectReserveAsset,
          usdc(1),
          subjectReserveQuantity,
          managerFees[0],
          protocolDirectFee,
          premiumPercentage
        );
        const returnedCKTokenIssueQuantity = await subject();
        expect(expectedCKTokenIssueQuantity).to.eq(returnedCKTokenIssueQuantity);
      });
    });
  });

  describe("#getExpectedReserveRedeemQuantity", async () => {
    let subjectCKToken: Address;
    let subjectReserveAsset: Address;
    let subjectCKTokenQuantity: BigNumber;
    let ckValuerAddress: Address;

    let ckToken: CKToken;
    let managerFees: BigNumber[];
    let protocolDirectFee: BigNumber;
    let premiumPercentage: BigNumber;

    beforeEach(async () => {
      ckToken = await setup.createCKToken(
        [setup.weth.address, setup.usdc.address, setup.wbtc.address, setup.dai.address],
        [ether(1), usdc(270), bitcoin(1).div(10), ether(600)],
        [setup.issuanceModule.address, customOracleNavIssuanceModule.address]
      );
      const managerIssuanceHook = await getRandomAddress();
      const managerRedemptionHook = await getRandomAddress();
      const reserveAssets = [setup.usdc.address, setup.weth.address];
      const managerFeeRecipient = feeRecipient.address;
      // Set manager issue fee to 0.1% and redeem to 0.2%
      managerFees = [ether(0.001), ether(0.002)];
      // Set max managerFee to 2%
      const maxManagerFee = ether(0.02);
      // Set premium to 1%
      premiumPercentage = ether(0.01);
      // Set max premium to 10%
      const maxPremiumPercentage = ether(0.1);
      // Set min CKToken supply to 1 unit
      const minCKTokenSupply = ether(1);

      const navIssuanceSettings = {
        managerIssuanceHook,
        managerRedemptionHook,
        reserveAssets,
        ckValuer: ckValuerAddress,
        feeRecipient: managerFeeRecipient,
        managerFees,
        maxManagerFee,
        premiumPercentage,
        maxPremiumPercentage,
        minCKTokenSupply,
      } as CustomOracleNAVIssuanceSettings;

      await customOracleNavIssuanceModule.initialize(ckToken.address, navIssuanceSettings);
      // Approve tokens to the controller
      await setup.weth.approve(setup.controller.address, ether(100));
      await setup.usdc.approve(setup.controller.address, usdc(1000000));
      await setup.wbtc.approve(setup.controller.address, bitcoin(1000000));
      await setup.dai.approve(setup.controller.address, ether(1000000));

      // Seed with 10 supply
      await setup.issuanceModule.connect(owner.wallet).initialize(ckToken.address, ADDRESS_ZERO);
      await setup.issuanceModule.connect(owner.wallet).issue(ckToken.address, ether(10), owner.address);

      protocolDirectFee = ether(.02);
      await setup.controller.addFee(customOracleNavIssuanceModule.address, THREE, protocolDirectFee);

      const protocolManagerFee = ether(.3);
      await setup.controller.addFee(customOracleNavIssuanceModule.address, ONE, protocolManagerFee);

      subjectCKToken = ckToken.address;
    });

    async function subject(): Promise<any> {
      return customOracleNavIssuanceModule.getExpectedReserveRedeemQuantity(subjectCKToken, subjectReserveAsset, subjectCKTokenQuantity);
    }

    context("with a custom ck valuer", () => {
      const usdcValuation: BigNumber = ether(370);
      const wethValuation: BigNumber = ether(1.85);
      before(async() => {
        const ckValuerMock = await deployer.mocks.deployCustomCKValuerMock();
        await ckValuerMock.setValuation(setup.usdc.address, usdcValuation);
        await ckValuerMock.setValuation(setup.weth.address, wethValuation);
        ckValuerAddress = ckValuerMock.address;
      });

      context("when redeming usdc", () => {
        before(() => {
          subjectReserveAsset = setup.usdc.address;
          subjectCKTokenQuantity = ether(1);
        });

        it("then the price from the custom ck valuer is used", async() => {
          const usdcRedeemAmountFrom1Set = await subject();
          expect(usdcRedeemAmountFrom1Set).to.eq(getExpectedReserveRedeemQuantity(
            subjectCKTokenQuantity,
            usdcValuation,
            usdc(1), // USDC base units
            managerFees[1],
            protocolDirectFee, // Protocol fee percentage
            premiumPercentage
          ));
        });
      });

      context("when redeming weth", () => {
        before(() => {
          subjectReserveAsset = setup.weth.address;
          subjectCKTokenQuantity = ether(1);
        });

        it("then the price from the custom ck valuer is used", async() => {
          const wethRedeemAmountFrom1Set = await subject();
          expect(wethRedeemAmountFrom1Set).to.eq(getExpectedReserveRedeemQuantity(
            subjectCKTokenQuantity,
            wethValuation,
            ether(1), // USDC base units
            managerFees[1],
            protocolDirectFee, // Protocol fee percentage
            premiumPercentage
          ));
        });
      });
    });

    context("with the default ck valuer", () => {
      before(() => {
        ckValuerAddress = ADDRESS_ZERO;
        subjectReserveAsset = setup.usdc.address;
        subjectCKTokenQuantity = ether(1);
      });

      it("should return the correct expected reserve asset redeem quantity", async () => {
        const ckTokenValuation = await setup.ckValuer.calculateCKTokenValuation(
          subjectCKToken,
          subjectReserveAsset
        );
        const expectedRedeemQuantity = getExpectedReserveRedeemQuantity(
          subjectCKTokenQuantity,
          ckTokenValuation,
          usdc(1), // USDC base units
          managerFees[1],
          protocolDirectFee, // Protocol fee percentage
          premiumPercentage
        );
        const returnedRedeemQuantity = await subject();
        expect(expectedRedeemQuantity).to.eq(returnedRedeemQuantity);
      });
    });
  });

  describe("#isIssueValid", async () => {
    let subjectCKToken: Address;
    let subjectReserveAsset: Address;
    let subjectReserveQuantity: BigNumber;

    let ckToken: CKToken;

    beforeEach(async () => {
      ckToken = await setup.createCKToken(
        [setup.weth.address, setup.usdc.address, setup.wbtc.address, setup.dai.address],
        [ether(1), usdc(270), bitcoin(1).div(10), ether(600)],
        [setup.issuanceModule.address, customOracleNavIssuanceModule.address]
      );
      const managerIssuanceHook = await getRandomAddress();
      const managerRedemptionHook = await getRandomAddress();
      const reserveAssets = [setup.usdc.address, setup.weth.address];
      const managerFeeRecipient = feeRecipient.address;
      // Set manager issue fee to 0.1% and redeem to 0.2%
      const managerFees = [ether(0.001), ether(0.002)];
      // Set max managerFee to 2%
      const maxManagerFee = ether(0.02);
      // Set premium to 1%
      const premiumPercentage = ether(0.01);
      // Set max premium to 10%
      const maxPremiumPercentage = ether(0.1);
      // Set min CKToken supply to 100 units
      const minCKTokenSupply = ether(1);

      const navIssuanceSettings = {
        managerIssuanceHook,
        managerRedemptionHook,
        reserveAssets,
        ckValuer: ADDRESS_ZERO,
        feeRecipient: managerFeeRecipient,
        managerFees,
        maxManagerFee,
        premiumPercentage,
        maxPremiumPercentage,
        minCKTokenSupply,
      } as CustomOracleNAVIssuanceSettings;

      await customOracleNavIssuanceModule.initialize(ckToken.address, navIssuanceSettings);
      // Approve tokens to the controller
      await setup.weth.approve(setup.controller.address, ether(100));
      await setup.usdc.approve(setup.controller.address, usdc(1000000));
      await setup.wbtc.approve(setup.controller.address, bitcoin(1000000));
      await setup.dai.approve(setup.controller.address, ether(1000000));

      // Seed with 10 supply
      await setup.issuanceModule.connect(owner.wallet).initialize(ckToken.address, ADDRESS_ZERO);
      await setup.issuanceModule.connect(owner.wallet).issue(ckToken.address, ether(10), owner.address);

      const protocolDirectFee = ether(.02);
      await setup.controller.addFee(customOracleNavIssuanceModule.address, TWO, protocolDirectFee);

      const protocolManagerFee = ether(.3);
      await setup.controller.addFee(customOracleNavIssuanceModule.address, ZERO, protocolManagerFee);

      subjectCKToken = ckToken.address;
      subjectReserveAsset = setup.usdc.address;
      subjectReserveQuantity = usdc(100);
    });

    async function subject(): Promise<any> {
      return customOracleNavIssuanceModule.isIssueValid(subjectCKToken, subjectReserveAsset, subjectReserveQuantity);
    }

    it("should return true", async () => {
      const returnedValue = await subject();
      expect(returnedValue).to.eq(true);
    });

    describe("when total supply is less than min required for NAV issuance", async () => {
      beforeEach(async () => {
        // Redeem below required
        await setup.issuanceModule.connect(owner.wallet).redeem(ckToken.address, ether(9.5), owner.address);
      });

      it("returns false", async () => {
        const returnedValue = await subject();
        expect(returnedValue).to.eq(false);
      });
    });

    describe("when the issue quantity is 0", async () => {
      beforeEach(async () => {
        subjectReserveQuantity = ZERO;
      });

      it("returns false", async () => {
        const returnedValue = await subject();
        expect(returnedValue).to.eq(false);
      });
    });

    describe("when the reserve asset is not valid", async () => {
      beforeEach(async () => {
        subjectReserveAsset = setup.wbtc.address;
      });

      it("returns false", async () => {
        const returnedValue = await subject();
        expect(returnedValue).to.eq(false);
      });
    });
  });

  describe("#isRedeemValid", async () => {
    let subjectCKToken: Address;
    let subjectReserveAsset: Address;
    let subjectCKTokenQuantity: BigNumber;

    let ckToken: CKToken;

    beforeEach(async () => {
      ckToken = await setup.createCKToken(
        [setup.weth.address, setup.usdc.address, setup.wbtc.address, setup.dai.address],
        [ether(1), usdc(270), bitcoin(1).div(10), ether(600)],
        [setup.issuanceModule.address, customOracleNavIssuanceModule.address]
      );
      const managerIssuanceHook = await getRandomAddress();
      const managerRedemptionHook = await getRandomAddress();
      const reserveAssets = [setup.usdc.address, setup.weth.address];
      const managerFeeRecipient = feeRecipient.address;
      // Set manager issue fee to 0.1% and redeem to 0.2%
      const managerFees = [ether(0.001), ether(0.002)];
      // Set max managerFee to 2%
      const maxManagerFee = ether(0.02);
      // Set premium to 1%
      const premiumPercentage = ether(0.01);
      // Set max premium to 10%
      const maxPremiumPercentage = ether(0.1);
      // Set min CKToken supply to 1 unit
      const minCKTokenSupply = ether(1);

      const navIssuanceSettings = {
        managerIssuanceHook,
        managerRedemptionHook,
        reserveAssets,
        ckValuer: ADDRESS_ZERO,
        feeRecipient: managerFeeRecipient,
        managerFees,
        maxManagerFee,
        premiumPercentage,
        maxPremiumPercentage,
        minCKTokenSupply,
      } as CustomOracleNAVIssuanceSettings;

      await customOracleNavIssuanceModule.initialize(ckToken.address, navIssuanceSettings);
      // Approve tokens to the controller
      await setup.weth.approve(setup.controller.address, ether(100));
      await setup.usdc.approve(setup.controller.address, usdc(1000000));
      await setup.wbtc.approve(setup.controller.address, bitcoin(1000000));
      await setup.dai.approve(setup.controller.address, ether(1000000));

      // Seed with 10 supply
      await setup.issuanceModule.connect(owner.wallet).initialize(ckToken.address, ADDRESS_ZERO);
      await setup.issuanceModule.connect(owner.wallet).issue(ckToken.address, ether(10), owner.address);

      const protocolDirectFee = ether(.02);
      await setup.controller.addFee(customOracleNavIssuanceModule.address, THREE, protocolDirectFee);

      const protocolManagerFee = ether(.3);
      await setup.controller.addFee(customOracleNavIssuanceModule.address, ONE, protocolManagerFee);

      subjectCKToken = ckToken.address;
      subjectReserveAsset = setup.usdc.address;
      subjectCKTokenQuantity = ether(1);
    });

    async function subject(): Promise<any> {
      return customOracleNavIssuanceModule.isRedeemValid(subjectCKToken, subjectReserveAsset, subjectCKTokenQuantity);
    }

    it("should return true", async () => {
      const returnedValue = await subject();
      expect(returnedValue).to.eq(true);
    });

    describe("when total supply is less than min required for NAV issuance", async () => {
      beforeEach(async () => {
        // Redeem below required
        await setup.issuanceModule.connect(owner.wallet).redeem(ckToken.address, ether(9), owner.address);
        subjectCKTokenQuantity = ether(0.01);
      });

      it("returns false", async () => {
        const returnedValue = await subject();
        expect(returnedValue).to.eq(false);
      });
    });

    describe("when there isn't sufficient reserve asset for withdraw", async () => {
      beforeEach(async () => {
        // Add self as module and update the position state
        await setup.controller.addModule(owner.address);
        ckToken = ckToken.connect(owner.wallet);
        await ckToken.addModule(owner.address);
        await ckToken.initializeModule();

        // Remove USDC position
        await ckToken.editDefaultPositionUnit(setup.usdc.address, ZERO);

        subjectCKTokenQuantity = ether(1);
      });

      it("returns false", async () => {
        const returnedValue = await subject();
        expect(returnedValue).to.eq(false);
      });
    });

    describe("when the redeem quantity is 0", async () => {
      beforeEach(async () => {
        subjectCKTokenQuantity = ZERO;
      });

      it("returns false", async () => {
        const returnedValue = await subject();
        expect(returnedValue).to.eq(false);
      });
    });

    describe("when the reserve asset is not valid", async () => {
      beforeEach(async () => {
        await setup.wbtc.approve(setup.controller.address, bitcoin(1000000));
        subjectReserveAsset = setup.wbtc.address;
      });

      it("returns false", async () => {
        const returnedValue = await subject();
        expect(returnedValue).to.eq(false);
      });
    });
  });

  describe("#issue", async () => {
    let ckToken: CKToken;

    let subjectCKToken: Address;
    let subjectReserveAsset: Address;
    let subjectReserveQuantity: BigNumber;
    let subjectMinCKTokenReceived: BigNumber;
    let subjectTo: Account;
    let subjectCaller: Account;
    let ckValuerAddress: Address;
    let ckValuerMock: ICKValuer;

    let navIssuanceSettings: CustomOracleNAVIssuanceSettings;
    let managerIssuanceHook: Address;
    let managerFees: BigNumber[];
    let premiumPercentage: BigNumber;
    let units: BigNumber[];
    let issueQuantity: BigNumber;

    context("when there are 4 components and reserve asset is USDC", async () => {
      beforeEach(async () => {
        units = [ether(1), usdc(270), bitcoin(1).div(10), ether(600)];
        ckToken = await setup.createCKToken(
          [setup.weth.address, setup.usdc.address, setup.wbtc.address, setup.dai.address],
          units, // Set is valued at 2000 USDC
          [setup.issuanceModule.address, customOracleNavIssuanceModule.address]
        );
        const managerRedemptionHook = await getRandomAddress();
        const reserveAssets = [setup.usdc.address, setup.weth.address];
        const managerFeeRecipient = feeRecipient.address;
        // Set max managerFee to 20%
        const maxManagerFee = ether(0.2);
        // Set max premium to 10%
        const maxPremiumPercentage = ether(0.1);
        // Set min CKToken supply required
        const minCKTokenSupply = ether(1);

        navIssuanceSettings = {
          managerIssuanceHook,
          managerRedemptionHook,
          ckValuer: ckValuerAddress,
          reserveAssets,
          feeRecipient: managerFeeRecipient,
          managerFees,
          maxManagerFee,
          premiumPercentage,
          maxPremiumPercentage,
          minCKTokenSupply,
        } as CustomOracleNAVIssuanceSettings;

        await customOracleNavIssuanceModule.initialize(ckToken.address, navIssuanceSettings);
        // Approve tokens to the controller
        await setup.weth.approve(setup.controller.address, ether(100));
        await setup.usdc.approve(setup.controller.address, usdc(1000000));
        await setup.wbtc.approve(setup.controller.address, bitcoin(1000000));
        await setup.dai.approve(setup.controller.address, ether(1000000));

        // Seed with 2 supply
        await setup.issuanceModule.connect(owner.wallet).initialize(ckToken.address, ADDRESS_ZERO);
        await setup.issuanceModule.connect(owner.wallet).issue(ckToken.address, ether(2), owner.address);

        // Issue with 1k USDC
        issueQuantity = usdc(1000);

        await setup.usdc.approve(customOracleNavIssuanceModule.address, issueQuantity);

        subjectCKToken = ckToken.address;
        subjectReserveAsset = setup.usdc.address;
        subjectReserveQuantity = issueQuantity;
        subjectMinCKTokenReceived = ether(0);
        subjectTo = recipient;
        subjectCaller = owner;
      });

      async function subject(): Promise<any> {
        return customOracleNavIssuanceModule.connect(subjectCaller.wallet).issue(
          subjectCKToken,
          subjectReserveAsset,
          subjectReserveQuantity,
          subjectMinCKTokenReceived,
          subjectTo.address
        );
      }

      context("when using a custom valuer", () => {
        before(async () => {
          managerIssuanceHook = ADDRESS_ZERO;
          // Set fees to 0
          managerFees = [ether(0), ether(0)];
          premiumPercentage = ether(0);
          ckValuerMock = await deployer.mocks.deployCustomCKValuerMock();
          // set valued at $500 by the custom ck valuer
          await ckValuerMock.setValuation(setup.usdc.address, ether(370));
          await ckValuerMock.setValuation(setup.weth.address, ether(1.85)); // 370/200
          ckValuerAddress = ckValuerMock.address;
        });
        beforeEach(() => {
          subjectReserveQuantity = usdc(296);
          subjectMinCKTokenReceived = ether("0.8");
        });

        it("should use the custom valuer to compute the issue amount", async() => {
          const expectedCKTokenIssueQuantity = await getExpectedCKTokenIssueQuantity(
            ckToken,
            ckValuerMock,
            subjectReserveAsset,
            usdc(1), // USDC base units 10^6
            subjectReserveQuantity,
            managerFees[0],
            ZERO, // Protocol direct fee
            premiumPercentage
          );
          await subject();
          const issuedBalance = await ckToken.balanceOf(recipient.address);
          expect(issuedBalance).to.eq(expectedCKTokenIssueQuantity);
        });
      });

      context("when there are no fees and no issuance hooks", async () => {
        before(async () => {
          managerIssuanceHook = ADDRESS_ZERO;
          ckValuerAddress = ADDRESS_ZERO;
          // Set fees to 0
          managerFees = [ether(0), ether(0)];
          // Set premium percentage to 50 bps
          premiumPercentage = ether(0.005);
        });

        it("should issue the CK to the recipient", async () => {
          const expectedCKTokenIssueQuantity = await getExpectedCKTokenIssueQuantity(
            ckToken,
            setup.ckValuer,
            subjectReserveAsset,
            usdc(1), // USDC base units 10^6
            subjectReserveQuantity,
            managerFees[0],
            ZERO, // Protocol direct fee
            premiumPercentage
          );

          await subject();

          const issuedBalance = await ckToken.balanceOf(recipient.address);
          expect(issuedBalance).to.eq(expectedCKTokenIssueQuantity);
        });

        it("should have deposited the reserve asset into the CKToken", async () => {
          const preIssueUSDCBalance = await setup.usdc.balanceOf(ckToken.address);

          await subject();

          const postIssueUSDCBalance = await setup.usdc.balanceOf(ckToken.address);
          const expectedUSDCBalance = preIssueUSDCBalance.add(issueQuantity);
          expect(postIssueUSDCBalance).to.eq(expectedUSDCBalance);
        });

        it("should have updated the reserve asset position correctly", async () => {
          const previousCKTokenSupply = await ckToken.totalSupply();

          await subject();

          const currentCKTokenSupply = await ckToken.totalSupply();
          const defaultPositionUnit = await ckToken.getDefaultPositionRealUnit(subjectReserveAsset);

          // (Previous supply * previous units + current units) / current supply
          const newPositionMultiplier = await ckToken.positionMultiplier();
          const expectedPositionUnit = getExpectedIssuePositionUnit(
            units[1],
            issueQuantity,
            previousCKTokenSupply,
            currentCKTokenSupply,
            newPositionMultiplier,
            managerFees[0],
            ZERO // Protocol fee percentage
          );

          expect(defaultPositionUnit).to.eq(expectedPositionUnit);
        });

        it("should have updated the position multiplier correctly", async () => {
          const previousCKTokenSupply = await ckToken.totalSupply();
          const preIssuePositionMultiplier = await ckToken.positionMultiplier();

          await subject();

          const currentCKTokenSupply = await ckToken.totalSupply();
          const postIssuePositionMultiplier = await ckToken.positionMultiplier();

          const expectedPositionMultiplier = getExpectedIssuePositionMultiplier(
            preIssuePositionMultiplier,
            previousCKTokenSupply,
            currentCKTokenSupply
          );
          expect(postIssuePositionMultiplier).to.eq(expectedPositionMultiplier);
        });

        it("should emit the CKTokenNAVIssued event", async () => {
          const expectedCKTokenIssued = await customOracleNavIssuanceModule.getExpectedCKTokenIssueQuantity(
            subjectCKToken,
            subjectReserveAsset,
            subjectReserveQuantity
          );
          await expect(subject()).to.emit(customOracleNavIssuanceModule, "CKTokenNAVIssued").withArgs(
            subjectCKToken,
            subjectCaller.address,
            subjectTo.address,
            subjectReserveAsset,
            ADDRESS_ZERO,
            expectedCKTokenIssued,
            ZERO,
            ZERO
          );
        });

        it("should reconcile balances", async () => {
          await reconcileBalances(ckToken, subject, owner);
        });

        describe("when the issue quantity is extremely small", async () => {
          beforeEach(async () => {
            subjectReserveQuantity = ONE;
          });

          it("should issue the CK to the recipient", async () => {
            const expectedCKTokenIssueQuantity = await getExpectedCKTokenIssueQuantity(
              ckToken,
              setup.ckValuer,
              subjectReserveAsset,
              usdc(1), // USDC base units 10^6
              subjectReserveQuantity,
              managerFees[0],
              ZERO, // Protocol direct fee
              premiumPercentage
            );

            await subject();

            const issuedBalance = await ckToken.balanceOf(recipient.address);

            expect(issuedBalance).to.eq(expectedCKTokenIssueQuantity);
          });

          it("should have deposited the reserve asset into the CKToken", async () => {
            const preIssueUSDCBalance = await setup.usdc.balanceOf(ckToken.address);

            await subject();

            const postIssueUSDCBalance = await setup.usdc.balanceOf(ckToken.address);
            const expectedUSDCBalance = preIssueUSDCBalance.add(subjectReserveQuantity);

            expect(postIssueUSDCBalance).to.eq(expectedUSDCBalance);
          });

          it("should have updated the reserve asset position correctly", async () => {
            const previousCKTokenSupply = await ckToken.totalSupply();

            await subject();

            const currentCKTokenSupply = await ckToken.totalSupply();
            const usdcPositionUnit = await ckToken.getDefaultPositionRealUnit(subjectReserveAsset);

            // (Previous supply * previous units + current units) / current supply
            const newPositionMultiplier = await ckToken.positionMultiplier();
            const expectedPositionUnit = getExpectedIssuePositionUnit(
              units[1],
              subjectReserveQuantity,
              previousCKTokenSupply,
              currentCKTokenSupply,
              newPositionMultiplier,
              managerFees[0],
              ZERO // Protocol fee percentage
            );

            expect(usdcPositionUnit).to.eq(expectedPositionUnit);
          });

          it("should have updated the position multiplier correctly", async () => {
            const previousCKTokenSupply = await ckToken.totalSupply();
            const preIssuePositionMultiplier = await ckToken.positionMultiplier();

            await subject();

            const currentCKTokenSupply = await ckToken.totalSupply();
            const postIssuePositionMultiplier = await ckToken.positionMultiplier();

            const expectedPositionMultiplier = getExpectedIssuePositionMultiplier(
              preIssuePositionMultiplier,
              previousCKTokenSupply,
              currentCKTokenSupply
            );

            expect(postIssuePositionMultiplier).to.eq(expectedPositionMultiplier);
          });

          it("should reconcile balances", async () => {
            await reconcileBalances(ckToken, subject, owner);
          });
        });

        describe("when a CKToken position is not in default state", async () => {
          beforeEach(async () => {
            // Add self as module and update the position state
            await setup.controller.addModule(owner.address);
            ckToken = ckToken.connect(owner.wallet);
            await ckToken.addModule(owner.address);
            await ckToken.initializeModule();

            await ckToken.addExternalPositionModule(setup.usdc.address, ADDRESS_ZERO);

            // Move default USDC to external position
            await ckToken.editDefaultPositionUnit(setup.usdc.address, ZERO);
            await ckToken.editExternalPositionUnit(setup.usdc.address, ADDRESS_ZERO, units[1]);
          });

          it("should have updated the reserve asset position correctly", async () => {
            const previousCKTokenSupply = await ckToken.totalSupply();

            await subject();

            const currentCKTokenSupply = await ckToken.totalSupply();
            const defaultUnit = await ckToken.getDefaultPositionRealUnit(subjectReserveAsset);

            // (Previous supply * previous units + current units) / current supply
            const newPositionMultiplier = await ckToken.positionMultiplier();
            const expectedPositionUnit = getExpectedIssuePositionUnit(
              ZERO, // Previous units are 0
              subjectReserveQuantity,
              previousCKTokenSupply,
              currentCKTokenSupply,
              newPositionMultiplier,
              managerFees[0],
              ZERO // Protocol fee percentage
            );

            expect(defaultUnit).to.eq(expectedPositionUnit);
          });

          it("should have updated the position multiplier correctly", async () => {
            const previousCKTokenSupply = await ckToken.totalSupply();
            const preIssuePositionMultiplier = await ckToken.positionMultiplier();

            await subject();

            const currentCKTokenSupply = await ckToken.totalSupply();
            const postIssuePositionMultiplier = await ckToken.positionMultiplier();

            const expectedPositionMultiplier = getExpectedIssuePositionMultiplier(
              preIssuePositionMultiplier,
              previousCKTokenSupply,
              currentCKTokenSupply
            );
            expect(postIssuePositionMultiplier).to.eq(expectedPositionMultiplier);
          });

          it("should reconcile balances", async () => {
            await reconcileBalances(ckToken, subject, owner);
          });
        });

        describe("when total supply is less than min required for NAV issuance", async () => {
          beforeEach(async () => {
            // Redeem below required
            await setup.issuanceModule.connect(owner.wallet).redeem(ckToken.address, ether(1.5), owner.address);
          });

          it("should revert", async () => {
            await expect(subject()).to.be.revertedWith("Supply must be greater than minimum to enable issuance");
          });
        });

        describe("when the issue quantity is 0", async () => {
          beforeEach(async () => {
            subjectReserveQuantity = ZERO;
          });

          it("should revert", async () => {
            await expect(subject()).to.be.revertedWith("Quantity must be > 0");
          });
        });

        describe("when the reserve asset is not valid", async () => {
          beforeEach(async () => {
            await setup.wbtc.approve(setup.controller.address, bitcoin(1000000));
            subjectReserveAsset = setup.wbtc.address;
          });

          it("should revert", async () => {
            await expect(subject()).to.be.revertedWith("Must be valid reserve asset");
          });
        });

        describe("when CKToken received is less than min required", async () => {
          beforeEach(async () => {
            subjectMinCKTokenReceived = ether(100);
          });

          it("should revert", async () => {
            await expect(subject()).to.be.revertedWith("Must be greater than min CKToken");
          });
        });

        describe("when the CKToken is not enabled on the controller", async () => {
          beforeEach(async () => {
            const nonEnabledCKToken = await setup.createNonControllerEnabledCKToken(
              [setup.weth.address],
              [ether(1)],
              [customOracleNavIssuanceModule.address]
            );

            subjectCKToken = nonEnabledCKToken.address;
          });

          it("should revert", async () => {
            await expect(subject()).to.be.revertedWith("Must be a valid and initialized CKToken");
          });
        });
      });

      context("when there are fees enabled and no issuance hooks", async () => {
        let protocolDirectFee: BigNumber;
        let protocolManagerFee: BigNumber;

        before(async () => {
          managerIssuanceHook = ADDRESS_ZERO;
          ckValuerAddress = ADDRESS_ZERO;
          managerFees = [ether(0.1), ether(0.1)];
          premiumPercentage = ether(0.005);
        });

        beforeEach(async () => {
          protocolDirectFee = ether(.02);
          await setup.controller.addFee(customOracleNavIssuanceModule.address, TWO, protocolDirectFee);

          protocolManagerFee = ether(.3);
          await setup.controller.addFee(customOracleNavIssuanceModule.address, ZERO, protocolManagerFee);
        });

        async function subject(): Promise<any> {
          return customOracleNavIssuanceModule.connect(subjectCaller.wallet).issue(
            subjectCKToken,
            subjectReserveAsset,
            subjectReserveQuantity,
            subjectMinCKTokenReceived,
            subjectTo.address
          );
        }

        it("should issue the CK to the recipient", async () => {
          const expectedCKTokenIssueQuantity = await getExpectedCKTokenIssueQuantity(
            ckToken,
            setup.ckValuer,
            subjectReserveAsset,
            usdc(1), // USDC base units 10^6
            subjectReserveQuantity,
            managerFees[0],
            protocolDirectFee, // Protocol direct fee
            premiumPercentage
          );
          await subject();

          const issuedBalance = await ckToken.balanceOf(recipient.address);
          expect(issuedBalance).to.eq(expectedCKTokenIssueQuantity);
        });

        it("should have deposited the reserve asset into the CKToken", async () => {
          const preIssueUSDCBalance = await setup.usdc.balanceOf(ckToken.address);

          await subject();

          const postIssueUSDCBalance = await setup.usdc.balanceOf(ckToken.address);

          const postFeeQuantity = getExpectedPostFeeQuantity(
            issueQuantity,
            managerFees[0],
            protocolDirectFee
          );
          const expectedUSDCBalance = preIssueUSDCBalance.add(postFeeQuantity);
          expect(postIssueUSDCBalance).to.eq(expectedUSDCBalance);
        });

        it("should have updated the reserve asset position correctly", async () => {
          const previousCKTokenSupply = await ckToken.totalSupply();

          await subject();

          const currentCKTokenSupply = await ckToken.totalSupply();
          const usdcPositionUnit = await ckToken.getDefaultPositionRealUnit(subjectReserveAsset);

          // (Previous supply * previous units + current units) / current supply
          const newPositionMultiplier = await ckToken.positionMultiplier();
          const expectedPositionUnit = getExpectedIssuePositionUnit(
            units[1],
            issueQuantity,
            previousCKTokenSupply,
            currentCKTokenSupply,
            newPositionMultiplier,
            managerFees[0],
            protocolDirectFee
          );

          expect(usdcPositionUnit).to.eq(expectedPositionUnit);
        });

        it("should have updated the position multiplier correctly", async () => {
          const previousCKTokenSupply = await ckToken.totalSupply();
          const preIssuePositionMultiplier = await ckToken.positionMultiplier();

          await subject();

          const currentCKTokenSupply = await ckToken.totalSupply();
          const postIssuePositionMultiplier = await ckToken.positionMultiplier();

          const expectedPositionMultiplier = getExpectedIssuePositionMultiplier(
            preIssuePositionMultiplier,
            previousCKTokenSupply,
            currentCKTokenSupply
          );
          expect(postIssuePositionMultiplier).to.eq(expectedPositionMultiplier);
        });

        it("should have properly distributed the fees", async () => {
          const preIssuedManagerBalance = await setup.usdc.balanceOf(feeRecipient.address);

          const protocolFeeRecipientAddress = await setup.controller.feeRecipient();
          const preIssuedProtocolFeeRecipientBalance = await setup.usdc.balanceOf(protocolFeeRecipientAddress);

          await subject();

          const postIssuedProtocolFeeRecipientBalance = await setup.usdc.balanceOf(protocolFeeRecipientAddress);
          const protocolFeePercentage = preciseMul(managerFees[0], protocolManagerFee).add(protocolDirectFee);
          const protocolFeeAmount = preciseMul(subjectReserveQuantity, protocolFeePercentage);
          const expectedPostIssuanceBalance = preIssuedProtocolFeeRecipientBalance.add(protocolFeeAmount);
          expect(postIssuedProtocolFeeRecipientBalance).to.eq(expectedPostIssuanceBalance);

          const postIssuedManagerBalance = await setup.usdc.balanceOf(feeRecipient.address);
          const realizedManagerFeePercent = managerFees[0].sub(preciseMul(managerFees[0], protocolManagerFee));
          const managerFeeAmount = preciseMul(realizedManagerFeePercent, subjectReserveQuantity);
          const expectedPostIssuanceManagerBalance = preIssuedManagerBalance.add(managerFeeAmount);
          expect(postIssuedManagerBalance).to.eq(expectedPostIssuanceManagerBalance);
        });

        it("should reconcile balances", async () => {
          await reconcileBalances(ckToken, subject, owner);
        });
      });

      context("when there are fees, premiums and an issuance hooks", async () => {
        let issuanceHookContract: NAVIssuanceHookMock;

        before(async () => {
          issuanceHookContract = await deployer.mocks.deployNavIssuanceHookMock();
          ckValuerAddress = ADDRESS_ZERO;

          managerIssuanceHook = issuanceHookContract.address;
        });

        async function subject(): Promise<any> {
          return customOracleNavIssuanceModule.issue(
            subjectCKToken,
            subjectReserveAsset,
            subjectReserveQuantity,
            subjectMinCKTokenReceived,
            subjectTo.address
          );
        }

        it("should properly call the pre-issue hooks", async () => {
          await subject();
          const retrievedCKToken = await issuanceHookContract.retrievedCKToken();
          const retrievedReserveAsset = await issuanceHookContract.retrievedReserveAsset();
          const retrievedReserveAssetQuantity = await issuanceHookContract.retrievedReserveAssetQuantity();
          const retrievedSender = await issuanceHookContract.retrievedSender();
          const retrievedTo = await issuanceHookContract.retrievedTo();

          expect(retrievedCKToken).to.eq(subjectCKToken);
          expect(retrievedReserveAsset).to.eq(subjectReserveAsset);
          expect(retrievedReserveAssetQuantity).to.eq(subjectReserveQuantity);
          expect(retrievedSender).to.eq(owner.address);
          expect(retrievedTo).to.eq(subjectTo.address);
        });
      });
    });
  });

  describe("#issueWithEther", async () => {
    let ckToken: CKToken;

    let subjectCKToken: Address;
    let subjectMinCKTokenReceived: BigNumber;
    let subjectTo: Account;
    let subjectCaller: Account;
    let subjectValue: BigNumber;

    let navIssuanceSettings: CustomOracleNAVIssuanceSettings;
    let managerIssuanceHook: Address;
    let managerFees: BigNumber[];
    let premiumPercentage: BigNumber;
    let units: BigNumber[];
    let issueQuantity: BigNumber;

    context("when there are 4 components and reserve asset is ETH", async () => {
      beforeEach(async () => {
        // Valued at 2000 USDC
        units = [ether(1), usdc(270), bitcoin(1).div(10), ether(600)];
        ckToken = await setup.createCKToken(
          [setup.weth.address, setup.usdc.address, setup.wbtc.address, setup.dai.address],
          units, // Set is valued at 2000 USDC
          [setup.issuanceModule.address, customOracleNavIssuanceModule.address]
        );
        const managerRedemptionHook = await getRandomAddress();
        const reserveAssets = [setup.usdc.address, setup.weth.address];
        const managerFeeRecipient = feeRecipient.address;
        // Set max managerFee to 20%
        const maxManagerFee = ether(0.2);
        // Set max premium to 10%
        const maxPremiumPercentage = ether(0.1);
        // Set min CKToken supply required
        const minCKTokenSupply = ether(1);

        navIssuanceSettings = {
          managerIssuanceHook,
          managerRedemptionHook,
          reserveAssets,
          ckValuer: ADDRESS_ZERO,
          feeRecipient: managerFeeRecipient,
          managerFees,
          maxManagerFee,
          premiumPercentage,
          maxPremiumPercentage,
          minCKTokenSupply,
        } as CustomOracleNAVIssuanceSettings;

        await customOracleNavIssuanceModule.initialize(ckToken.address, navIssuanceSettings);
        // Approve tokens to the controller
        await setup.weth.approve(setup.controller.address, ether(100));
        await setup.usdc.approve(setup.controller.address, usdc(1000000));
        await setup.wbtc.approve(setup.controller.address, bitcoin(1000000));
        await setup.dai.approve(setup.controller.address, ether(1000000));

        // Seed with 2 supply
        await setup.issuanceModule.connect(owner.wallet).initialize(ckToken.address, ADDRESS_ZERO);
        await setup.issuanceModule.connect(owner.wallet).issue(ckToken.address, ether(2), owner.address);

        // Issue with 1 ETH
        issueQuantity = ether(0.1);

        subjectCKToken = ckToken.address;
        subjectMinCKTokenReceived = ether(0);
        subjectTo = recipient;
        subjectValue = issueQuantity;
        subjectCaller = owner;
      });

      context("when there are no fees and no issuance hooks", async () => {
        before(async () => {
          managerIssuanceHook = ADDRESS_ZERO;
          // Set fees to 0
          managerFees = [ether(0), ether(0)];
          premiumPercentage = ether(0.005);
        });

        async function subject(): Promise<any> {
          return customOracleNavIssuanceModule.connect(subjectCaller.wallet).issueWithEther(
            subjectCKToken,
            subjectMinCKTokenReceived,
            subjectTo.address,
            {
              value: subjectValue,
            }
          );
        }

        it("should issue the CK to the recipient", async () => {
          const expectedCKTokenIssueQuantity = await getExpectedCKTokenIssueQuantity(
            ckToken,
            setup.ckValuer,
            setup.weth.address,
            ether(1), // ETH base units 10^18
            subjectValue,
            managerFees[0],
            ZERO, // Protocol direct fee
            premiumPercentage
          );
          await subject();

          const issuedBalance = await ckToken.balanceOf(recipient.address);
          expect(issuedBalance).to.eq(expectedCKTokenIssueQuantity);
        });

        it("should have deposited WETH into the CKToken", async () => {
          const preIssueWETHBalance = await setup.weth.balanceOf(ckToken.address);

          await subject();

          const postIssueWETHBalance = await setup.weth.balanceOf(ckToken.address);
          const expectedWETHBalance = preIssueWETHBalance.add(issueQuantity);
          expect(postIssueWETHBalance).to.eq(expectedWETHBalance);
        });

        it("should have updated the reserve asset position correctly", async () => {
          const previousCKTokenSupply = await ckToken.totalSupply();

          await subject();

          const currentCKTokenSupply = await ckToken.totalSupply();
          const defaultPositionUnit = await ckToken.getDefaultPositionRealUnit(setup.weth.address);

          const newPositionMultiplier = await ckToken.positionMultiplier();
          const expectedPositionUnit = getExpectedIssuePositionUnit(
            units[0],
            issueQuantity,
            previousCKTokenSupply,
            currentCKTokenSupply,
            newPositionMultiplier,
            managerFees[0],
            ZERO // Protocol fee percentage
          );

          expect(defaultPositionUnit).to.eq(expectedPositionUnit);
        });

        it("should have updated the position multiplier correctly", async () => {
          const previousCKTokenSupply = await ckToken.totalSupply();
          const preIssuePositionMultiplier = await ckToken.positionMultiplier();

          await subject();

          const currentCKTokenSupply = await ckToken.totalSupply();
          const postIssuePositionMultiplier = await ckToken.positionMultiplier();

          const expectedPositionMultiplier = getExpectedIssuePositionMultiplier(
            preIssuePositionMultiplier,
            previousCKTokenSupply,
            currentCKTokenSupply
          );
          expect(postIssuePositionMultiplier).to.eq(expectedPositionMultiplier);
        });

        it("should emit the CKTokenNAVIssued event", async () => {
          const expectedCKTokenIssued = await customOracleNavIssuanceModule.getExpectedCKTokenIssueQuantity(
            subjectCKToken,
            setup.weth.address,
            subjectValue
          );
          await expect(subject()).to.emit(customOracleNavIssuanceModule, "CKTokenNAVIssued").withArgs(
            subjectCKToken,
            subjectCaller.address,
            subjectTo.address,
            setup.weth.address,
            ADDRESS_ZERO,
            expectedCKTokenIssued,
            ZERO,
            ZERO
          );
        });

        it("should reconcile balances", async () => {
          await reconcileBalances(ckToken, subject, owner);
        });

        describe("when a CKToken position is not in default state", async () => {
          beforeEach(async () => {
            // Add self as module and update the position state
            await setup.controller.addModule(owner.address);
            ckToken = ckToken.connect(owner.wallet);
            await ckToken.addModule(owner.address);
            await ckToken.initializeModule();

            await ckToken.addExternalPositionModule(setup.weth.address, ADDRESS_ZERO);

            // Move default WETH to external position
            await ckToken.editDefaultPositionUnit(setup.weth.address, ZERO);
            await ckToken.editExternalPositionUnit(setup.weth.address, ADDRESS_ZERO, units[0]);
          });

          it("should have updated the reserve asset position correctly", async () => {
            const previousCKTokenSupply = await ckToken.totalSupply();

            await subject();

            const currentCKTokenSupply = await ckToken.totalSupply();
            const defaultUnit = await ckToken.getDefaultPositionRealUnit(setup.weth.address);

            // (Previous supply * previous units + current units) / current supply
            const newPositionMultiplier = await ckToken.positionMultiplier();
            const expectedPositionUnit = getExpectedIssuePositionUnit(
              ZERO, // Previous units are 0
              subjectValue,
              previousCKTokenSupply,
              currentCKTokenSupply,
              newPositionMultiplier,
              managerFees[0],
              ZERO // Protocol fee percentage
            );

            expect(defaultUnit).to.eq(expectedPositionUnit);
          });

          it("should have updated the position multiplier correctly", async () => {
            const previousCKTokenSupply = await ckToken.totalSupply();
            const preIssuePositionMultiplier = await ckToken.positionMultiplier();

            await subject();

            const currentCKTokenSupply = await ckToken.totalSupply();
            const postIssuePositionMultiplier = await ckToken.positionMultiplier();

            const expectedPositionMultiplier = getExpectedIssuePositionMultiplier(
              preIssuePositionMultiplier,
              previousCKTokenSupply,
              currentCKTokenSupply
            );
            expect(postIssuePositionMultiplier).to.eq(expectedPositionMultiplier);
          });

          it("should reconcile balances", async () => {
            await reconcileBalances(ckToken, subject, owner);
          });
        });

        describe("when total supply is less than min required for NAV issuance", async () => {
          beforeEach(async () => {
            // Redeem below required
            await setup.issuanceModule.connect(owner.wallet).redeem(ckToken.address, ether(1.5), owner.address);
          });

          it("should revert", async () => {
            await expect(subject()).to.be.revertedWith("Supply must be greater than minimum to enable issuance");
          });
        });

        describe("when the value is 0", async () => {
          beforeEach(async () => {
            subjectValue = ZERO;
          });

          it("should revert", async () => {
            await expect(subject()).to.be.revertedWith("Quantity must be > 0");
          });
        });

        describe("when CKToken received is less than minimum", async () => {
          beforeEach(async () => {
            subjectMinCKTokenReceived = ether(100);
          });

          it("should revert", async () => {
            await expect(subject()).to.be.revertedWith("Must be greater than min CKToken");
          });
        });

        describe("when the CKToken is not enabled on the controller", async () => {
          beforeEach(async () => {
            const nonEnabledCKToken = await setup.createNonControllerEnabledCKToken(
              [setup.weth.address],
              [ether(1)],
              [customOracleNavIssuanceModule.address]
            );

            subjectCKToken = nonEnabledCKToken.address;
          });

          it("should revert", async () => {
            await expect(subject()).to.be.revertedWith("Must be a valid and initialized CKToken");
          });
        });
      });

      context("when there are fees enabled and no issuance hooks", async () => {
        let protocolDirectFee: BigNumber;
        let protocolManagerFee: BigNumber;

        before(async () => {
          managerIssuanceHook = ADDRESS_ZERO;
          managerFees = [ether(0.1), ether(0.1)];
          premiumPercentage = ether(0.1);
        });

        beforeEach(async () => {
          protocolDirectFee = ether(.02);
          await setup.controller.addFee(customOracleNavIssuanceModule.address, TWO, protocolDirectFee);

          protocolManagerFee = ether(.3);
          await setup.controller.addFee(customOracleNavIssuanceModule.address, ZERO, protocolManagerFee);
        });

        async function subject(): Promise<any> {
          return customOracleNavIssuanceModule.connect(subjectCaller.wallet).issueWithEther(
            subjectCKToken,
            subjectMinCKTokenReceived,
            subjectTo.address,
            {
              value: subjectValue,
            }
          );
        }

        it("should issue the CK to the recipient", async () => {
          const expectedCKTokenIssueQuantity = await getExpectedCKTokenIssueQuantity(
            ckToken,
            setup.ckValuer,
            setup.weth.address,
            ether(1), // ETH base units 10^18
            subjectValue,
            managerFees[0],
            protocolDirectFee, // Protocol direct fee
            premiumPercentage
          );

          await subject();

          const issuedBalance = await ckToken.balanceOf(recipient.address);
          expect(issuedBalance).to.eq(expectedCKTokenIssueQuantity);
        });

        it("should have deposited the reserve asset into the CKToken", async () => {
          const preIssueWETHBalance = await setup.weth.balanceOf(ckToken.address);

          await subject();

          const postIssueWETHBalance = await setup.weth.balanceOf(ckToken.address);

          const postFeeQuantity = getExpectedPostFeeQuantity(
            issueQuantity,
            managerFees[0],
            protocolDirectFee
          );
          const expectedWETHBalance = preIssueWETHBalance.add(postFeeQuantity);
          expect(postIssueWETHBalance).to.eq(expectedWETHBalance);
        });

        it("should have updated the reserve asset position correctly", async () => {
          const previousCKTokenSupply = await ckToken.totalSupply();

          await subject();

          const currentCKTokenSupply = await ckToken.totalSupply();
          const wethPositionUnit = await ckToken.getDefaultPositionRealUnit(setup.weth.address);

          // (Previous supply * previous units + current units) / current supply
          const newPositionMultiplier = await ckToken.positionMultiplier();
          const expectedPositionUnit = getExpectedIssuePositionUnit(
            units[0],
            issueQuantity,
            previousCKTokenSupply,
            currentCKTokenSupply,
            newPositionMultiplier,
            managerFees[0],
            protocolDirectFee
          );

          expect(wethPositionUnit).to.eq(expectedPositionUnit);
        });

        it("should have updated the position multiplier correctly", async () => {
          const previousCKTokenSupply = await ckToken.totalSupply();
          const preIssuePositionMultiplier = await ckToken.positionMultiplier();

          await subject();

          const currentCKTokenSupply = await ckToken.totalSupply();
          const postIssuePositionMultiplier = await ckToken.positionMultiplier();

          const expectedPositionMultiplier = getExpectedIssuePositionMultiplier(
            preIssuePositionMultiplier,
            previousCKTokenSupply,
            currentCKTokenSupply
          );
          expect(postIssuePositionMultiplier).to.eq(expectedPositionMultiplier);
        });

        it("should have properly distributed the fees in WETH", async () => {
          const preIssuedManagerBalance = await setup.weth.balanceOf(feeRecipient.address);

          const protocolFeeRecipientAddress = await setup.controller.feeRecipient();
          const preIssuedProtocolFeeRecipientBalance = await setup.weth.balanceOf(protocolFeeRecipientAddress);

          await subject();

          const postIssuedProtocolFeeRecipientBalance = await setup.weth.balanceOf(protocolFeeRecipientAddress);
          const protocolFeePercentage = preciseMul(managerFees[0], protocolManagerFee).add(protocolDirectFee);
          const protocolFeeAmount = preciseMul(subjectValue, protocolFeePercentage);
          const expectedPostIssuanceBalance = preIssuedProtocolFeeRecipientBalance.add(protocolFeeAmount);
          expect(postIssuedProtocolFeeRecipientBalance).to.eq(expectedPostIssuanceBalance);

          const postIssuedManagerBalance = await setup.weth.balanceOf(feeRecipient.address);
          const realizedManagerFeePercent = managerFees[0].sub(preciseMul(managerFees[0], protocolManagerFee));
          const managerFeeAmount = preciseMul(realizedManagerFeePercent, subjectValue);
          const expectedPostIssuanceManagerBalance = preIssuedManagerBalance.add(managerFeeAmount);
          expect(postIssuedManagerBalance).to.eq(expectedPostIssuanceManagerBalance);
        });

        it("should reconcile balances", async () => {
          await reconcileBalances(ckToken, subject, owner);
        });
      });
    });
  });

  describe("#redeem", async () => {
    let ckToken: CKToken;

    let subjectCKToken: Address;
    let subjectReserveAsset: Address;
    let subjectCKTokenQuantity: BigNumber;
    let subjectMinReserveQuantityReceived: BigNumber;
    let subjectTo: Account;
    let subjectCaller: Account;

    let navIssuanceSettings: CustomOracleNAVIssuanceSettings;
    let ckValuerAddress: Address;
    let ckValuerMock: ICKValuer;
    let managerRedemptionHook: Address;
    let managerFees: BigNumber[];
    let premiumPercentage: BigNumber;
    let units: BigNumber[];
    let redeemQuantity: BigNumber;

    context("when there are 4 components and reserve asset is USDC", async () => {
      beforeEach(async () => {
        // Valued at 2000 USDC
        units = [ether(1), usdc(570), bitcoin(1).div(10), ether(300)];
        ckToken = await setup.createCKToken(
          [setup.weth.address, setup.usdc.address, setup.wbtc.address, setup.dai.address],
          units, // Set is valued at 2000 USDC
          [setup.issuanceModule.address, customOracleNavIssuanceModule.address]
        );
        const managerIssuanceHook = await getRandomAddress();
        const reserveAssets = [setup.usdc.address, setup.weth.address];
        const managerFeeRecipient = feeRecipient.address;
        // Set max managerFee to 20%
        const maxManagerFee = ether(0.2);
        // Set max premium to 10%
        const maxPremiumPercentage = ether(0.1);
        // Set min CKToken supply required
        const minCKTokenSupply = ether(1);

        navIssuanceSettings = {
          managerIssuanceHook,
          managerRedemptionHook,
          reserveAssets,
          ckValuer: ckValuerAddress,
          feeRecipient: managerFeeRecipient,
          managerFees,
          maxManagerFee,
          premiumPercentage,
          maxPremiumPercentage,
          minCKTokenSupply,
        } as CustomOracleNAVIssuanceSettings;

        await customOracleNavIssuanceModule.initialize(ckToken.address, navIssuanceSettings);
        // Approve tokens to the controller
        await setup.weth.approve(setup.controller.address, ether(100));
        await setup.usdc.approve(setup.controller.address, usdc(1000000));
        await setup.wbtc.approve(setup.controller.address, bitcoin(1000000));
        await setup.dai.approve(setup.controller.address, ether(1000000));

        // Seed with 10 supply
        await setup.issuanceModule.connect(owner.wallet).initialize(ckToken.address, ADDRESS_ZERO);
        await setup.issuanceModule.connect(owner.wallet).issue(ckToken.address, ether(10), owner.address);

        // Redeem 1 CKToken
        redeemQuantity = ether(2.8);

        subjectCKToken = ckToken.address;
        subjectReserveAsset = setup.usdc.address;
        subjectCKTokenQuantity = redeemQuantity;
        subjectMinReserveQuantityReceived = ether(0);
        subjectTo = recipient;
        subjectCaller = owner;
      });

      async function subject(): Promise<any> {
        return customOracleNavIssuanceModule.connect(subjectCaller.wallet).redeem(
          subjectCKToken,
          subjectReserveAsset,
          subjectCKTokenQuantity,
          subjectMinReserveQuantityReceived,
          subjectTo.address
        );
      }

      context("when using a custom ck valuer", () => {
        before(async () => {
          managerRedemptionHook = ADDRESS_ZERO;
          // Set fees to 0
          managerFees = [ether(0), ether(0)];
          // Set premium percentage to 50 bps
          premiumPercentage = ether(0);
          ckValuerMock = await deployer.mocks.deployCustomCKValuerMock();
          // set valued at $500 by the custom ck valuer
          await ckValuerMock.setValuation(setup.usdc.address, ether(370));
          await ckValuerMock.setValuation(setup.weth.address, ether(1.85)); // 370/200
          ckValuerAddress = ckValuerMock.address;
        });
        beforeEach(() => {
          subjectCKTokenQuantity = ether("1.3");
          subjectMinReserveQuantityReceived = usdc(481);
        });

        it("should use the custom valuer to compute the redeem amount", async() => {
          await subject();
          const issuedBalance = await setup.usdc.balanceOf(subjectTo.address);
          const ckTokenValuation = await ckValuerMock.calculateCKTokenValuation(
            subjectCKToken,
            subjectReserveAsset
          );

          const expectedUSDCBalance = getExpectedReserveRedeemQuantity(
            subjectCKTokenQuantity,
            ckTokenValuation,
            usdc(1), // USDC base units
            managerFees[1],
            ZERO, // Protocol fee percentage
            premiumPercentage
          );
          expect(issuedBalance).to.eq(expectedUSDCBalance);
        });
      });

      context("when there are no fees and no redemption hooks", async () => {
        before(async () => {
          managerRedemptionHook = ADDRESS_ZERO;
          ckValuerAddress = ADDRESS_ZERO;
          // Set fees to 0
          managerFees = [ether(0), ether(0)];
          // Set premium percentage to 50 bps
          premiumPercentage = ether(0.005);
        });

        it("should reduce the CKToken supply", async () => {
          const previousSupply = await ckToken.totalSupply();
          const preRedeemBalance = await ckToken.balanceOf(owner.address);

          await subject();

          const currentSupply = await ckToken.totalSupply();
          const postRedeemBalance = await ckToken.balanceOf(owner.address);

          expect(preRedeemBalance.sub(postRedeemBalance)).to.eq(previousSupply.sub(currentSupply));
        });

        it("should have redeemed the reserve asset to the recipient", async () => {
          const ckTokenValuation = await setup.ckValuer.calculateCKTokenValuation(
            subjectCKToken,
            subjectReserveAsset
          );

          await subject();

          const postIssueUSDCBalance = await setup.usdc.balanceOf(recipient.address);
          const expectedUSDCBalance = getExpectedReserveRedeemQuantity(
            subjectCKTokenQuantity,
            ckTokenValuation,
            usdc(1), // USDC base units
            managerFees[1],
            ZERO, // Protocol fee percentage
            premiumPercentage
          );
          expect(postIssueUSDCBalance).to.eq(expectedUSDCBalance);
        });

        it("should have updated the reserve asset position correctly", async () => {
          const previousCKTokenSupply = await ckToken.totalSupply();
          const ckTokenValuation = await setup.ckValuer.calculateCKTokenValuation(
            subjectCKToken,
            subjectReserveAsset
          );

          await subject();

          const currentCKTokenSupply = await ckToken.totalSupply();
          const defaultPositionUnit = await ckToken.getDefaultPositionRealUnit(subjectReserveAsset);

          // (Previous supply * previous units + current units) / current supply
          const newPositionMultiplier = await ckToken.positionMultiplier();
          const expectedPositionUnit = getExpectedRedeemPositionUnit(
            units[1],
            redeemQuantity,
            ckTokenValuation,
            usdc(1), // USDC base units
            previousCKTokenSupply,
            currentCKTokenSupply,
            newPositionMultiplier,
            managerFees[1],
            ZERO, // Protocol fee percentage
            premiumPercentage,
          );

          expect(defaultPositionUnit).to.eq(expectedPositionUnit);
        });

        it("should have updated the position multiplier correctly", async () => {
          const previousCKTokenSupply = await ckToken.totalSupply();
          const preIssuePositionMultiplier = await ckToken.positionMultiplier();

          await subject();

          const currentCKTokenSupply = await ckToken.totalSupply();
          const postIssuePositionMultiplier = await ckToken.positionMultiplier();

          const expectedPositionMultiplier = getExpectedRedeemPositionMultiplier(
            preIssuePositionMultiplier,
            previousCKTokenSupply,
            currentCKTokenSupply
          );
          expect(postIssuePositionMultiplier).to.eq(expectedPositionMultiplier);
        });

        it("should emit the CKTokenNAVRedeemed event", async () => {
          await expect(subject()).to.emit(customOracleNavIssuanceModule, "CKTokenNAVRedeemed").withArgs(
            subjectCKToken,
            subjectCaller.address,
            subjectTo.address,
            subjectReserveAsset,
            ADDRESS_ZERO,
            subjectCKTokenQuantity,
            ZERO,
            ZERO
          );
        });

        it("should reconcile balances", async () => {
          await reconcileBalances(ckToken, subject, owner);
        });

        describe("when the redeem quantity is extremely small", async () => {
          beforeEach(async () => {
            subjectCKTokenQuantity = ONE;
          });

          it("should reduce the CKToken supply", async () => {
            const previousSupply = await ckToken.totalSupply();
            const preRedeemBalance = await ckToken.balanceOf(owner.address);

            await subject();

            const currentSupply = await ckToken.totalSupply();
            const postRedeemBalance = await ckToken.balanceOf(owner.address);

            expect(preRedeemBalance.sub(postRedeemBalance)).to.eq(previousSupply.sub(currentSupply));
          });

          it("should have redeemed the reserve asset to the recipient", async () => {
            const ckTokenValuation = await setup.ckValuer.calculateCKTokenValuation(
              subjectCKToken,
              subjectReserveAsset
            );

            await subject();

            const postIssueUSDCBalance = await setup.usdc.balanceOf(recipient.address);
            const expectedUSDCBalance = getExpectedReserveRedeemQuantity(
              subjectCKTokenQuantity,
              ckTokenValuation,
              usdc(1), // USDC base units
              managerFees[1],
              ZERO, // Protocol fee percentage
              premiumPercentage
            );
            expect(postIssueUSDCBalance).to.eq(expectedUSDCBalance);
          });

          it("should have updated the reserve asset position correctly", async () => {
            const previousCKTokenSupply = await ckToken.totalSupply();
            const ckTokenValuation = await setup.ckValuer.calculateCKTokenValuation(
              subjectCKToken,
              subjectReserveAsset
            );

            await subject();

            const currentCKTokenSupply = await ckToken.totalSupply();
            const defaultPositionUnit = await ckToken.getDefaultPositionRealUnit(subjectReserveAsset);

            // (Previous supply * previous units + current units) / current supply
            const newPositionMultiplier = await ckToken.positionMultiplier();
            const expectedPositionUnit = getExpectedRedeemPositionUnit(
              units[1],
              subjectCKTokenQuantity,
              ckTokenValuation,
              usdc(1), // USDC base units
              previousCKTokenSupply,
              currentCKTokenSupply,
              newPositionMultiplier,
              managerFees[1],
              ZERO, // Protocol fee percentage
              premiumPercentage,
            );
            expect(defaultPositionUnit).to.eq(expectedPositionUnit);
          });

          it("should have updated the position multiplier correctly", async () => {
            const previousCKTokenSupply = await ckToken.totalSupply();
            const preIssuePositionMultiplier = await ckToken.positionMultiplier();

            await subject();

            const currentCKTokenSupply = await ckToken.totalSupply();
            const postIssuePositionMultiplier = await ckToken.positionMultiplier();

            const expectedPositionMultiplier = getExpectedRedeemPositionMultiplier(
              preIssuePositionMultiplier,
              previousCKTokenSupply,
              currentCKTokenSupply
            );
            expect(postIssuePositionMultiplier).to.eq(expectedPositionMultiplier);
          });

          it("should reconcile balances", async () => {
            await reconcileBalances(ckToken, subject, owner);
          });
        });

        describe("when a CKToken position is not in default state", async () => {
          beforeEach(async () => {
            // Add self as module and update the position state
            await setup.controller.addModule(owner.address);
            ckToken = ckToken.connect(owner.wallet);
            await ckToken.addModule(owner.address);
            await ckToken.initializeModule();

            await ckToken.addExternalPositionModule(setup.usdc.address, ADDRESS_ZERO);

            // Convert half of default position to external position
            await ckToken.editDefaultPositionUnit(setup.usdc.address, units[1].div(2));
            await ckToken.editExternalPositionUnit(setup.usdc.address, ADDRESS_ZERO, units[1].div(2));

            subjectCKTokenQuantity = ether(0.1);
          });

          it("should have updated the reserve asset position correctly", async () => {
            const previousCKTokenSupply = await ckToken.totalSupply();
            const ckTokenValuation = await setup.ckValuer.calculateCKTokenValuation(
              subjectCKToken,
              subjectReserveAsset
            );

            await subject();

            const currentCKTokenSupply = await ckToken.totalSupply();
            const defaultPositionUnit = await ckToken.getDefaultPositionRealUnit(subjectReserveAsset);

            // (Previous supply * previous units + current units) / current supply
            const newPositionMultiplier = await ckToken.positionMultiplier();
            const expectedPositionUnit = getExpectedRedeemPositionUnit(
              units[1].div(2),
              subjectCKTokenQuantity,
              ckTokenValuation,
              usdc(1), // USDC base units
              previousCKTokenSupply,
              currentCKTokenSupply,
              newPositionMultiplier,
              managerFees[1],
              ZERO, // Protocol fee percentage
              premiumPercentage,
            );

            expect(defaultPositionUnit).to.eq(expectedPositionUnit);
          });

          it("should have updated the position multiplier correctly", async () => {
            const previousCKTokenSupply = await ckToken.totalSupply();
            const preIssuePositionMultiplier = await ckToken.positionMultiplier();

            await subject();

            const currentCKTokenSupply = await ckToken.totalSupply();
            const postIssuePositionMultiplier = await ckToken.positionMultiplier();

            const expectedPositionMultiplier = getExpectedRedeemPositionMultiplier(
              preIssuePositionMultiplier,
              previousCKTokenSupply,
              currentCKTokenSupply
            );
            expect(postIssuePositionMultiplier).to.eq(expectedPositionMultiplier);
          });

          it("should reconcile balances", async () => {
            await reconcileBalances(ckToken, subject, owner);
          });
        });

        describe("when total supply is less than min required for NAV issuance", async () => {
          beforeEach(async () => {
            // Redeem below required
            await setup.issuanceModule.connect(owner.wallet).redeem(ckToken.address, ether(9), owner.address);
            subjectCKTokenQuantity = ether(0.01);
          });

          it("should revert", async () => {
            await expect(subject()).to.be.revertedWith("Supply must be greater than minimum to enable redemption");
          });
        });

        describe("when there isn't sufficient reserve asset for withdraw", async () => {
          beforeEach(async () => {
            // Add self as module and update the position state
            await setup.controller.addModule(owner.address);
            ckToken = ckToken.connect(owner.wallet);
            await ckToken.addModule(owner.address);
            await ckToken.initializeModule();

            // Remove USDC position
            await ckToken.editDefaultPositionUnit(setup.usdc.address, ZERO);

            subjectCKTokenQuantity = ether(1);
          });

          it("should revert", async () => {
            await expect(subject()).to.be.revertedWith("Must be greater than total available collateral");
          });
        });

        describe("when the redeem quantity is 0", async () => {
          beforeEach(async () => {
            subjectCKTokenQuantity = ZERO;
          });

          it("should revert", async () => {
            await expect(subject()).to.be.revertedWith("Quantity must be > 0");
          });
        });

        describe("when the reserve asset is not valid", async () => {
          beforeEach(async () => {
            await setup.wbtc.approve(setup.controller.address, bitcoin(1000000));
            subjectReserveAsset = setup.wbtc.address;
          });

          it("should revert", async () => {
            await expect(subject()).to.be.revertedWith("Must be valid reserve asset");
          });
        });

        describe("when reserve asset received is less than min required", async () => {
          beforeEach(async () => {
            subjectMinReserveQuantityReceived = ether(100);
          });

          it("should revert", async () => {
            await expect(subject()).to.be.revertedWith("Must be greater than min receive reserve quantity");
          });
        });

        describe("when the CKToken is not enabled on the controller", async () => {
          beforeEach(async () => {
            const nonEnabledCKToken = await setup.createNonControllerEnabledCKToken(
              [setup.weth.address],
              [ether(1)],
              [customOracleNavIssuanceModule.address]
            );

            subjectCKToken = nonEnabledCKToken.address;
          });

          it("should revert", async () => {
            await expect(subject()).to.be.revertedWith("Must be a valid and initialized CKToken");
          });
        });
      });

      context("when there are fees enabled and no redemption hooks", async () => {
        let protocolDirectFee: BigNumber;
        let protocolManagerFee: BigNumber;

        before(async () => {
          ckValuerAddress = ADDRESS_ZERO;
          managerRedemptionHook = ADDRESS_ZERO;
          managerFees = [ether(0.1), ether(0.1)];
          premiumPercentage = ether(0.005);
        });

        beforeEach(async () => {
          protocolDirectFee = ether(.02);
          await setup.controller.addFee(customOracleNavIssuanceModule.address, THREE, protocolDirectFee);

          protocolManagerFee = ether(.3);
          await setup.controller.addFee(customOracleNavIssuanceModule.address, ONE, protocolManagerFee);
        });

        async function subject(): Promise<any> {
          return customOracleNavIssuanceModule.connect(subjectCaller.wallet).redeem(
            subjectCKToken,
            subjectReserveAsset,
            subjectCKTokenQuantity,
            subjectMinReserveQuantityReceived,
            subjectTo.address
          );
        }

        it("should reduce the CKToken supply", async () => {
          const previousSupply = await ckToken.totalSupply();
          const preRedeemBalance = await ckToken.balanceOf(owner.address);
          await subject();
          const currentSupply = await ckToken.totalSupply();
          const postRedeemBalance = await ckToken.balanceOf(owner.address);

          expect(preRedeemBalance.sub(postRedeemBalance)).to.eq(previousSupply.sub(currentSupply));
        });

        it("should have redeemed the reserve asset to the recipient", async () => {
          const ckTokenValuation = await setup.ckValuer.calculateCKTokenValuation(
            subjectCKToken,
            subjectReserveAsset
          );
          await subject();
          const postIssueUSDCBalance = await setup.usdc.balanceOf(recipient.address);
          const expectedUSDCBalance = getExpectedReserveRedeemQuantity(
            subjectCKTokenQuantity,
            ckTokenValuation,
            usdc(1), // USDC base units
            managerFees[1],
            protocolDirectFee, // Protocol fee percentage
            premiumPercentage
          );
          expect(postIssueUSDCBalance).to.eq(expectedUSDCBalance);
        });

        it("should have updated the reserve asset position correctly", async () => {
          const previousCKTokenSupply = await ckToken.totalSupply();
          const ckTokenValuation = await setup.ckValuer.calculateCKTokenValuation(
            subjectCKToken,
            subjectReserveAsset
          );
          await subject();
          const currentCKTokenSupply = await ckToken.totalSupply();
          const defaultPositionUnit = await ckToken.getDefaultPositionRealUnit(subjectReserveAsset);

          // (Previous supply * previous units + current units) / current supply
          const newPositionMultiplier = await ckToken.positionMultiplier();
          const expectedPositionUnit = getExpectedRedeemPositionUnit(
            units[1],
            redeemQuantity,
            ckTokenValuation,
            usdc(1), // USDC base units
            previousCKTokenSupply,
            currentCKTokenSupply,
            newPositionMultiplier,
            managerFees[1],
            protocolDirectFee, // Protocol fee percentage
            premiumPercentage,
          );

          expect(defaultPositionUnit).to.eq(expectedPositionUnit);
        });

        it("should have updated the position multiplier correctly", async () => {
          const previousCKTokenSupply = await ckToken.totalSupply();
          const preIssuePositionMultiplier = await ckToken.positionMultiplier();
          await subject();
          const currentCKTokenSupply = await ckToken.totalSupply();
          const postIssuePositionMultiplier = await ckToken.positionMultiplier();

          const expectedPositionMultiplier = getExpectedRedeemPositionMultiplier(
            preIssuePositionMultiplier,
            previousCKTokenSupply,
            currentCKTokenSupply
          );
          expect(postIssuePositionMultiplier).to.eq(expectedPositionMultiplier);
        });

        it("should have properly distributed the fees", async () => {
          // Get starting balance of reserve asset held by the CKToken
          const preRedeemReserveAssetBalance = await setup.usdc.balanceOf(ckToken.address);

          // Get starting balance of manager
          const preRedeemManagerBalance = await setup.usdc.balanceOf(feeRecipient.address);

          // Get starting balance of the protocol fee recipient
          const protocolFeeRecipientAddress = await setup.controller.feeRecipient();
          const preRedeemProtocolFeeRecipientBalance = await setup.usdc.balanceOf(protocolFeeRecipientAddress);

          await subject();

          // Calculate the redeemed reserve asset amount
          const postRedeemReserveAssetBalance = await setup.usdc.balanceOf(ckToken.address);
          const redeemedReserveAssetAmont = preRedeemReserveAssetBalance.sub(postRedeemReserveAssetBalance);

          // Calculate expected protocol fee from redeemed reserve asset amount
          const postIssuedProtocolFeeRecipientBalance = await setup.usdc.balanceOf(protocolFeeRecipientAddress);
          const protocolFeePercentage = preciseMul(managerFees[0], protocolManagerFee).add(protocolDirectFee);
          const protocolFeeAmount = preciseMul(redeemedReserveAssetAmont, protocolFeePercentage);
          const expectedPostRedeemBalance = preRedeemProtocolFeeRecipientBalance.add(protocolFeeAmount);
          expect(postIssuedProtocolFeeRecipientBalance).to.eq(expectedPostRedeemBalance);

          // Calculate expected manager fee from redeemed reserve asset amount
          const postIssuedManagerBalance = await setup.usdc.balanceOf(feeRecipient.address);
          const realizedManagerFeePercent = managerFees[0].sub(preciseMul(managerFees[0], protocolManagerFee));
          const managerFeeAmount = preciseMul(realizedManagerFeePercent, redeemedReserveAssetAmont);
          const expectedPostRedeemManagerBalance = preRedeemManagerBalance.add(managerFeeAmount);
          expect(postIssuedManagerBalance).to.eq(expectedPostRedeemManagerBalance);
        });

        it("should reconcile balances", async () => {
          await reconcileBalances(ckToken, subject, owner);
        });
      });

      context("when there are fees, premiums and an redemption hook", async () => {
        let issuanceHookContract: ManagerIssuanceHookMock;

        before(async () => {
          ckValuerAddress = ADDRESS_ZERO;
          issuanceHookContract = await deployer.mocks.deployManagerIssuanceHookMock();

          managerRedemptionHook = issuanceHookContract.address;
        });

        async function subject(): Promise<any> {
          return customOracleNavIssuanceModule.connect(subjectCaller.wallet).redeem(
            subjectCKToken,
            subjectReserveAsset,
            subjectCKTokenQuantity,
            subjectMinReserveQuantityReceived,
            subjectTo.address
          );
        }

        it("should properly call the pre-issue hooks", async () => {
          await subject();

          const retrievedCKToken = await issuanceHookContract.retrievedCKToken();
          const retrievedIssueQuantity = await issuanceHookContract.retrievedIssueQuantity();
          const retrievedSender = await issuanceHookContract.retrievedSender();
          const retrievedTo = await issuanceHookContract.retrievedTo();

          expect(retrievedCKToken).to.eq(subjectCKToken);
          expect(retrievedIssueQuantity).to.eq(subjectCKTokenQuantity);
          expect(retrievedSender).to.eq(owner.address);
          expect(retrievedTo).to.eq(subjectTo.address);
        });
      });
    });
  });

  describe("#redeemIntoEther", async () => {
    let ckToken: CKToken;

    let subjectCKToken: Address;
    let subjectCKTokenQuantity: BigNumber;
    let subjectMinReserveQuantityReceived: BigNumber;
    let subjectTo: Account;
    let subjectCaller: Account;

    let navIssuanceSettings: CustomOracleNAVIssuanceSettings;
    let managerRedemptionHook: Address;
    let managerFees: BigNumber[];
    let premiumPercentage: BigNumber;
    let units: BigNumber[];
    let redeemQuantity: BigNumber;

    context("when there are 4 components and reserve asset is USDC", async () => {
      beforeEach(async () => {
        // Valued at 2000 USDC
        units = [ether(1), usdc(270), bitcoin(1).div(10), ether(600)];
        ckToken = await setup.createCKToken(
          [setup.weth.address, setup.usdc.address, setup.wbtc.address, setup.dai.address],
          units, // Set is valued at 2000 USDC
          [setup.issuanceModule.address, customOracleNavIssuanceModule.address]
        );
        const managerIssuanceHook = await getRandomAddress();
        const reserveAssets = [setup.usdc.address, setup.weth.address];
        const managerFeeRecipient = feeRecipient.address;
        // Set max managerFee to 20%
        const maxManagerFee = ether(0.2);
        // Set max premium to 10%
        const maxPremiumPercentage = ether(0.1);
        // Set min CKToken supply required
        const minCKTokenSupply = ether(1);

        navIssuanceSettings = {
          managerIssuanceHook,
          managerRedemptionHook,
          reserveAssets,
          ckValuer: ADDRESS_ZERO,
          feeRecipient: managerFeeRecipient,
          managerFees,
          maxManagerFee,
          premiumPercentage,
          maxPremiumPercentage,
          minCKTokenSupply,
        } as CustomOracleNAVIssuanceSettings;

        await customOracleNavIssuanceModule.initialize(ckToken.address, navIssuanceSettings);
        // Approve tokens to the controller
        await setup.weth.approve(setup.controller.address, ether(100));
        await setup.usdc.approve(setup.controller.address, usdc(1000000));
        await setup.wbtc.approve(setup.controller.address, bitcoin(1000000));
        await setup.dai.approve(setup.controller.address, ether(1000000));

        // Seed with 10 supply
        await setup.issuanceModule.connect(owner.wallet).initialize(ckToken.address, ADDRESS_ZERO);
        await setup.issuanceModule.connect(owner.wallet).issue(ckToken.address, ether(10), owner.address);

        // Redeem 1 CKToken
        redeemQuantity = ether(1);

        subjectCKToken = ckToken.address;
        subjectCKTokenQuantity = redeemQuantity;
        subjectMinReserveQuantityReceived = ether(0);
        subjectTo = recipient;
        subjectCaller = owner;
      });

      context("when there are no fees and no redemption hooks", async () => {
        before(async () => {
          managerRedemptionHook = ADDRESS_ZERO;
          // Set fees to 0
          managerFees = [ether(0), ether(0)];
          // Set premium percentage to 50 bps
          premiumPercentage = ether(0.005);
        });

        async function subject(): Promise<any> {
          return customOracleNavIssuanceModule.connect(subjectCaller.wallet).redeemIntoEther(
            subjectCKToken,
            subjectCKTokenQuantity,
            subjectMinReserveQuantityReceived,
            subjectTo.address,
          );
        }

        it("should reduce the CKToken supply", async () => {
          const previousSupply = await ckToken.totalSupply();
          const preRedeemBalance = await ckToken.balanceOf(owner.address);

          await subject();

          const currentSupply = await ckToken.totalSupply();
          const postRedeemBalance = await ckToken.balanceOf(owner.address);

          expect(preRedeemBalance.sub(postRedeemBalance)).to.eq(previousSupply.sub(currentSupply));
        });

        it("should have redeemed the reserve asset to the recipient", async () => {
          const provider = getProvider();
          const ckTokenValuation = await setup.ckValuer.calculateCKTokenValuation(
            subjectCKToken,
            setup.weth.address
          );
          const preIssueETHBalance = await provider.getBalance(recipient.address);

          await subject();

          const postIssueETHBalance = await provider.getBalance(recipient.address);
          const expectedETHBalance = getExpectedReserveRedeemQuantity(
            subjectCKTokenQuantity,
            ckTokenValuation,
            ether(1), // ETH base units
            managerFees[1],
            ZERO, // Protocol fee percentage
            premiumPercentage
          );
          expect(postIssueETHBalance.sub(preIssueETHBalance)).to.eq(expectedETHBalance);
        });

        it("should have updated the reserve asset position correctly", async () => {
          const previousCKTokenSupply = await ckToken.totalSupply();
          const ckTokenValuation = await setup.ckValuer.calculateCKTokenValuation(
            subjectCKToken,
            setup.weth.address
          );

          await subject();

          const currentCKTokenSupply = await ckToken.totalSupply();
          const defaultPositionUnit = await ckToken.getDefaultPositionRealUnit(setup.weth.address);

          const newPositionMultiplier = await ckToken.positionMultiplier();
          const expectedPositionUnit = getExpectedRedeemPositionUnit(
            units[0],
            redeemQuantity,
            ckTokenValuation,
            ether(1), // ETH base units
            previousCKTokenSupply,
            currentCKTokenSupply,
            newPositionMultiplier,
            managerFees[1],
            ZERO, // Protocol fee percentage
            premiumPercentage,
          );

          expect(defaultPositionUnit).to.eq(expectedPositionUnit);
        });

        it("should have updated the position multiplier correctly", async () => {
          const previousCKTokenSupply = await ckToken.totalSupply();
          const preIssuePositionMultiplier = await ckToken.positionMultiplier();

          await subject();

          const currentCKTokenSupply = await ckToken.totalSupply();
          const postIssuePositionMultiplier = await ckToken.positionMultiplier();

          const expectedPositionMultiplier = getExpectedRedeemPositionMultiplier(
            preIssuePositionMultiplier,
            previousCKTokenSupply,
            currentCKTokenSupply
          );
          expect(postIssuePositionMultiplier).to.eq(expectedPositionMultiplier);
        });

        it("should emit the CKTokenNAVRedeemed event", async () => {
          await expect(subject()).to.emit(customOracleNavIssuanceModule, "CKTokenNAVRedeemed").withArgs(
            subjectCKToken,
            subjectCaller.address,
            subjectTo.address,
            setup.weth.address,
            ADDRESS_ZERO,
            subjectCKTokenQuantity,
            ZERO,
            ZERO
          );
        });

        it("should reconcile balances", async () => {
          await reconcileBalances(ckToken, subject, owner);
        });

        describe("when total supply is less than min required for NAV issuance", async () => {
          beforeEach(async () => {
            // Redeem below required
            await setup.issuanceModule.connect(owner.wallet).redeem(ckToken.address, ether(9), owner.address);
            subjectCKTokenQuantity = ether(0.01);
          });

          it("should revert", async () => {
            await expect(subject()).to.be.revertedWith("Supply must be greater than minimum to enable redemption");
          });
        });

        describe("when there isn't sufficient reserve asset for withdraw", async () => {
          beforeEach(async () => {
            // Add self as module and update the position state
            await setup.controller.addModule(owner.address);
            ckToken = ckToken.connect(owner.wallet);
            await ckToken.addModule(owner.address);
            await ckToken.initializeModule();

            // Remove WETH position
            await ckToken.editDefaultPositionUnit(setup.weth.address, ZERO);

            subjectCKTokenQuantity = ether(1);
          });

          it("should revert", async () => {
            await expect(subject()).to.be.revertedWith("Must be greater than total available collateral");
          });
        });

        describe("when the redeem quantity is 0", async () => {
          beforeEach(async () => {
            subjectCKTokenQuantity = ZERO;
          });

          it("should revert", async () => {
            await expect(subject()).to.be.revertedWith("Quantity must be > 0");
          });
        });

        describe("when reserve asset received is less than min required", async () => {
          beforeEach(async () => {
            subjectMinReserveQuantityReceived = ether(100);
          });

          it("should revert", async () => {
            await expect(subject()).to.be.revertedWith("Must be greater than min receive reserve quantity");
          });
        });

        describe("when the CKToken is not enabled on the controller", async () => {
          beforeEach(async () => {
            const nonEnabledCKToken = await setup.createNonControllerEnabledCKToken(
              [setup.weth.address],
              [ether(1)],
              [customOracleNavIssuanceModule.address]
            );

            subjectCKToken = nonEnabledCKToken.address;
          });

          it("should revert", async () => {
            await expect(subject()).to.be.revertedWith("Must be a valid and initialized CKToken");
          });
        });
      });

      context("when there are fees enabled and no redemption hooks", async () => {
        let protocolDirectFee: BigNumber;
        let protocolManagerFee: BigNumber;

        before(async () => {
          managerRedemptionHook = ADDRESS_ZERO;
          managerFees = [ether(0.1), ether(0.1)];
          premiumPercentage = ether(0.005);
        });

        beforeEach(async () => {
          protocolDirectFee = ether(.02);
          await setup.controller.addFee(customOracleNavIssuanceModule.address, THREE, protocolDirectFee);

          protocolManagerFee = ether(.3);
          await setup.controller.addFee(customOracleNavIssuanceModule.address, ONE, protocolManagerFee);
        });

        async function subject(): Promise<any> {
          return customOracleNavIssuanceModule.connect(subjectCaller.wallet).redeemIntoEther(
            subjectCKToken,
            subjectCKTokenQuantity,
            subjectMinReserveQuantityReceived,
            subjectTo.address,
          );
        }

        it("should reduce the CKToken supply", async () => {
          const previousSupply = await ckToken.totalSupply();
          const preRedeemBalance = await ckToken.balanceOf(owner.address);

          await subject();

          const currentSupply = await ckToken.totalSupply();
          const postRedeemBalance = await ckToken.balanceOf(owner.address);

          expect(preRedeemBalance.sub(postRedeemBalance)).to.eq(previousSupply.sub(currentSupply));
        });

        it("should have redeemed the reserve asset to the recipient", async () => {
          const provider = getProvider();
          const ckTokenValuation = await setup.ckValuer.calculateCKTokenValuation(
            subjectCKToken,
            setup.weth.address
          );
          const preIssueETHBalance = await provider.getBalance(recipient.address);

          await subject();

          const postIssueETHBalance = await provider.getBalance(recipient.address);
          const expectedETHBalance = getExpectedReserveRedeemQuantity(
            subjectCKTokenQuantity,
            ckTokenValuation,
            ether(1), // ETH base units
            managerFees[1],
            protocolDirectFee, // Protocol direct fee percentage
            premiumPercentage
          );
          expect(postIssueETHBalance.sub(preIssueETHBalance)).to.eq(expectedETHBalance);
        });

        it("should have updated the reserve asset position correctly", async () => {
          const previousCKTokenSupply = await ckToken.totalSupply();
          const ckTokenValuation = await setup.ckValuer.calculateCKTokenValuation(
            subjectCKToken,
            setup.weth.address
          );

          await subject();

          const currentCKTokenSupply = await ckToken.totalSupply();
          const defaultPositionUnit = await ckToken.getDefaultPositionRealUnit(setup.weth.address);

          const newPositionMultiplier = await ckToken.positionMultiplier();
          const expectedPositionUnit = getExpectedRedeemPositionUnit(
            units[0],
            redeemQuantity,
            ckTokenValuation,
            ether(1), // ETH base units
            previousCKTokenSupply,
            currentCKTokenSupply,
            newPositionMultiplier,
            managerFees[1],
            protocolDirectFee, // Protocol direct fee percentage
            premiumPercentage,
          );

          expect(defaultPositionUnit).to.eq(expectedPositionUnit);
        });

        it("should have updated the position multiplier correctly", async () => {
          const previousCKTokenSupply = await ckToken.totalSupply();
          const preIssuePositionMultiplier = await ckToken.positionMultiplier();

          await subject();

          const currentCKTokenSupply = await ckToken.totalSupply();
          const postIssuePositionMultiplier = await ckToken.positionMultiplier();

          const expectedPositionMultiplier = getExpectedRedeemPositionMultiplier(
            preIssuePositionMultiplier,
            previousCKTokenSupply,
            currentCKTokenSupply
          );
          expect(postIssuePositionMultiplier).to.eq(expectedPositionMultiplier);
        });

        it("should have properly distributed the fees in WETH", async () => {
          // Get starting balance of reserve asset held by the CKToken
          const preRedeemReserveAssetBalance = await setup.weth.balanceOf(ckToken.address);

          // Get starting balance of manager
          const preRedeemManagerBalance = await setup.weth.balanceOf(feeRecipient.address);

          // Get starting balance of the protocol fee recipient
          const protocolFeeRecipientAddress = await setup.controller.feeRecipient();
          const preRedeemProtocolFeeRecipientBalance = await setup.weth.balanceOf(protocolFeeRecipientAddress);

          await subject();

          // Calculate the redeemed reserve asset amount
          const postRedeemReserveAssetBalance = await setup.weth.balanceOf(ckToken.address);
          const redeemedReserveAssetAmont = preRedeemReserveAssetBalance.sub(postRedeemReserveAssetBalance);

          // Calculate expected protocol fee from redeemed reserve asset amount
          const postRedeemProtocolFeeRecipientBalance = await setup.weth.balanceOf(protocolFeeRecipientAddress);
          const protocolFeePercentage = preciseMul(managerFees[0], protocolManagerFee).add(protocolDirectFee);
          const protocolFeeAmount = preciseMul(redeemedReserveAssetAmont, protocolFeePercentage);
          const expectedPostIssuanceBalance = preRedeemProtocolFeeRecipientBalance.add(protocolFeeAmount);
          expect(postRedeemProtocolFeeRecipientBalance).to.eq(expectedPostIssuanceBalance);

          // Calculate expected manager fee from redeemed reserve asset amount
          const postRedeemManagerBalance = await setup.weth.balanceOf(feeRecipient.address);
          const realizedManagerFeePercent = managerFees[0].sub(preciseMul(managerFees[0], protocolManagerFee));
          const managerFeeAmount = preciseMul(realizedManagerFeePercent, redeemedReserveAssetAmont);
          const expectedPostIssuanceManagerBalance = preRedeemManagerBalance.add(managerFeeAmount);
          expect(postRedeemManagerBalance).to.eq(expectedPostIssuanceManagerBalance);
        });

        it("should reconcile balances", async () => {
          await reconcileBalances(ckToken, subject, owner);
        });
      });
    });
  });

  context("Manager admin functions", async () => {
    let subjectCKToken: Address;
    let subjectCaller: Account;

    let ckToken: CKToken;

    before(async () => {
      // Deploy a standard CKToken
      ckToken = await setup.createCKToken(
        [setup.weth.address],
        [ether(1)],
        [customOracleNavIssuanceModule.address]
      );

      const managerIssuanceHook = await getRandomAddress();
      const managerRedemptionHook = await getRandomAddress();
      const reserveAssets = [setup.weth.address, setup.usdc.address];
      const managerFeeRecipient = feeRecipient.address;
      // Set manager issue fee to 0.1% and redeem to 0.2%
      const managerFees = [ether(0.001), ether(0.002)];
      // Set max managerFee to 2%
      const maxManagerFee = ether(0.02);
      // Set premium to 1%
      const premiumPercentage = ether(0.01);
      // Set max premium to 10%
      const maxPremiumPercentage = ether(0.1);
      // Set min CKToken supply to 100 units
      const minCKTokenSupply = ether(100);

      const navIssuanceSettings = {
        managerIssuanceHook,
        managerRedemptionHook,
        reserveAssets,
        ckValuer: ADDRESS_ZERO,
        feeRecipient: managerFeeRecipient,
        managerFees,
        maxManagerFee,
        premiumPercentage,
        maxPremiumPercentage,
        minCKTokenSupply,
      } as CustomOracleNAVIssuanceSettings;

      await customOracleNavIssuanceModule.initialize(
        ckToken.address,
        navIssuanceSettings
      );

      const protocolDirectFee = ether(.02);
      await setup.controller.addFee(customOracleNavIssuanceModule.address, TWO, protocolDirectFee);

      const protocolManagerFee = ether(.3);
      await setup.controller.addFee(customOracleNavIssuanceModule.address, ZERO, protocolManagerFee);
    });

    describe("#addReserveAsset", async () => {
      let subjectReserveAsset: Address;

      beforeEach(async () => {
        subjectCKToken = ckToken.address;
        subjectReserveAsset = setup.dai.address;
        subjectCaller = owner;
      });

      async function subject(): Promise<any> {
        return customOracleNavIssuanceModule.connect(subjectCaller.wallet).addReserveAsset(subjectCKToken, subjectReserveAsset);
      }

      it("should add the reserve asset", async () => {
        await subject();
        const isReserveAssetAdded = await customOracleNavIssuanceModule.isReserveAsset(subjectCKToken, subjectReserveAsset);
        const reserveAssets = await customOracleNavIssuanceModule.getReserveAssets(subjectCKToken);
        expect(isReserveAssetAdded).to.eq(true);
        expect(reserveAssets.length).to.eq(3);
      });

      it("should emit correct ReserveAssetAdded event", async () => {
        await expect(subject()).to.emit(customOracleNavIssuanceModule, "ReserveAssetAdded").withArgs(
          subjectCKToken,
          subjectReserveAsset
        );
      });

      shouldRevertIfTheCallerIsNotTheManager(subject);
      shouldRevertIfCKTokenIsInvalid(subject);
      shouldRevertIfModuleDisabled(subject);

      describe("when the reserve asset exists", async () => {
        beforeEach(async () => {
          subjectReserveAsset = setup.weth.address;
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Reserve asset already exists");
        });
      });
    });

    describe("#removeReserveAsset", async () => {
      let subjectReserveAsset: Address;

      beforeEach(async () => {
        subjectCKToken = ckToken.address;
        subjectReserveAsset = setup.usdc.address;
        subjectCaller = owner;
      });

      async function subject(): Promise<any> {
        return customOracleNavIssuanceModule.connect(subjectCaller.wallet).removeReserveAsset(subjectCKToken, subjectReserveAsset);
      }

      it("should remove the reserve asset", async () => {
        await subject();
        const isReserveAsset = await customOracleNavIssuanceModule.isReserveAsset(subjectCKToken, subjectReserveAsset);
        const reserveAssets = await customOracleNavIssuanceModule.getReserveAssets(subjectCKToken);

        expect(isReserveAsset).to.eq(false);
        expect(JSON.stringify(reserveAssets)).to.eq(JSON.stringify([setup.weth.address]));
      });

      it("should emit correct ReserveAssetRemoved event", async () => {
        await expect(subject()).to.emit(customOracleNavIssuanceModule, "ReserveAssetRemoved").withArgs(
          subjectCKToken,
          subjectReserveAsset
        );
      });

      shouldRevertIfTheCallerIsNotTheManager(subject);
      shouldRevertIfCKTokenIsInvalid(subject);
      shouldRevertIfModuleDisabled(subject);

      describe("when the reserve asset does not exist", async () => {
        beforeEach(async () => {
          subjectReserveAsset = setup.wbtc.address;
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Reserve asset does not exist");
        });
      });
    });

    describe("#editPremium", async () => {
      let subjectPremium: BigNumber;

      beforeEach(async () => {
        subjectCKToken = ckToken.address;
        subjectPremium = ether(0.02);
        subjectCaller = owner;
      });

      async function subject(): Promise<any> {
        return customOracleNavIssuanceModule.connect(subjectCaller.wallet).editPremium(subjectCKToken, subjectPremium);
      }

      it("should edit the premium", async () => {
        await subject();
        const retrievedPremium = await customOracleNavIssuanceModule.getIssuePremium(subjectCKToken, ADDRESS_ZERO, ZERO);
        expect(retrievedPremium).to.eq(subjectPremium);
      });

      it("should emit correct PremiumEdited event", async () => {
        await expect(subject()).to.emit(customOracleNavIssuanceModule, "PremiumEdited").withArgs(
          subjectCKToken,
          subjectPremium
        );
      });

      shouldRevertIfTheCallerIsNotTheManager(subject);
      shouldRevertIfCKTokenIsInvalid(subject);
      shouldRevertIfModuleDisabled(subject);

      describe("when the premium is greater than maximum allowed", async () => {
        beforeEach(async () => {
          subjectPremium = ether(1);
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Premium must be less than maximum allowed");
        });
      });
    });

    describe("#editManagerFee", async () => {
      let subjectManagerFee: BigNumber;
      let subjectFeeIndex: BigNumber;

      beforeEach(async () => {
        subjectCKToken = ckToken.address;
        subjectManagerFee = ether(0.01);
        subjectFeeIndex = ZERO;
        subjectCaller = owner;
      });

      async function subject(): Promise<any> {
        return customOracleNavIssuanceModule.connect(subjectCaller.wallet).editManagerFee(subjectCKToken, subjectManagerFee, subjectFeeIndex);
      }

      it("should edit the manager issue fee", async () => {
        await subject();
        const managerIssueFee = await customOracleNavIssuanceModule.getManagerFee(subjectCKToken, subjectFeeIndex);

        expect(managerIssueFee).to.eq(subjectManagerFee);
      });

      it("should emit correct ManagerFeeEdited event", async () => {
        await expect(subject()).to.emit(customOracleNavIssuanceModule, "ManagerFeeEdited").withArgs(
          subjectCKToken,
          subjectManagerFee,
          subjectFeeIndex
        );
      });

      describe("when editing the redeem fee", async () => {
        beforeEach(async () => {
          subjectManagerFee = ether(0.002);
          subjectFeeIndex = ONE;
        });

        it("should edit the manager redeem fee", async () => {
          await subject();
          const managerRedeemFee = await customOracleNavIssuanceModule.getManagerFee(subjectCKToken, subjectFeeIndex);

          expect(managerRedeemFee).to.eq(subjectManagerFee);
        });
      });

      shouldRevertIfTheCallerIsNotTheManager(subject);
      shouldRevertIfCKTokenIsInvalid(subject);
      shouldRevertIfModuleDisabled(subject);

      describe("when the manager fee is greater than maximum allowed", async () => {
        beforeEach(async () => {
          subjectManagerFee = ether(1);
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Manager fee must be less than maximum allowed");
        });
      });
    });

    describe("#editFeeRecipient", async () => {
      let subjectFeeRecipient: Address;

      beforeEach(async () => {
        subjectCKToken = ckToken.address;
        subjectFeeRecipient = feeRecipient.address;
        subjectCaller = owner;
      });

      async function subject(): Promise<any> {
        return customOracleNavIssuanceModule.connect(subjectCaller.wallet).editFeeRecipient(subjectCKToken, subjectFeeRecipient);
      }

      it("should edit the manager fee recipient", async () => {
        await subject();
        const navIssuanceSettings = await customOracleNavIssuanceModule.navIssuanceSettings(subjectCKToken);
        expect(navIssuanceSettings.feeRecipient).to.eq(subjectFeeRecipient);
      });

      it("should emit correct FeeRecipientEdited event", async () => {
        await expect(subject()).to.emit(customOracleNavIssuanceModule, "FeeRecipientEdited").withArgs(
          subjectCKToken,
          subjectFeeRecipient
        );
      });

      shouldRevertIfTheCallerIsNotTheManager(subject);
      shouldRevertIfCKTokenIsInvalid(subject);
      shouldRevertIfModuleDisabled(subject);

      describe("when the manager fee is greater than maximum allowed", async () => {
        beforeEach(async () => {
          subjectFeeRecipient = ADDRESS_ZERO;
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Fee recipient must not be 0 address");
        });
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
      describe("when the CKToken is not enabled on the controller", async () => {
        beforeEach(async () => {
          const nonEnabledCKToken = await setup.createNonControllerEnabledCKToken(
            [setup.weth.address],
            [ether(1)],
            [customOracleNavIssuanceModule.address]
          );

          subjectCKToken = nonEnabledCKToken.address;
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Must be a valid and initialized CKToken");
        });
      });
    }

    function shouldRevertIfModuleDisabled(subject: any) {
      describe("when the module is disabled", async () => {
        beforeEach(async () => {
          await ckToken.removeModule(customOracleNavIssuanceModule.address);
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Must be a valid and initialized CKToken");
        });
      });
    }
  });
});

async function reconcileBalances(ckToken: CKToken, subject: any, signer: Account): Promise<void> {
  await subject();

  const currentCKTokenSupply = await ckToken.totalSupply();
  const components = await ckToken.getComponents();
  for (let i = 0; i < components.length; i++) {
    const component = ERC20__factory.connect(components[i], signer.wallet);
    const defaultPositionUnit = await ckToken.getDefaultPositionRealUnit(component.address);

    const expectedBalance = preciseMul(defaultPositionUnit, currentCKTokenSupply);
    const actualBalance = await component.balanceOf(ckToken.address);

    expect(actualBalance).to.be.gte(expectedBalance);
  }
}
