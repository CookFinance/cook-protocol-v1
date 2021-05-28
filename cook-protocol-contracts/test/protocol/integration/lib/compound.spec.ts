import "module-alias/register";
import { BigNumber } from "@ethersproject/bignumber";

import { Address } from "@utils/types";
import { Account } from "@utils/test/types";
import { Compound, CompoundMock, InvokeMock, CKToken } from "@utils/contracts";
import { CEther, CERc20 } from "@utils/contracts/compound";
import DeployHelper from "@utils/deploys";
import {
  bitcoin,
  ether,
  preciseDiv,
} from "@utils/index";
import {
  getAccounts,
  getSystemFixture,
  getCompoundFixture,
  getEthBalance,
  getWaffleExpect,
  addSnapshotBeforeRestoreAfterEach,
} from "@utils/test/index";
import { CompoundFixture, SystemFixture } from "@utils/fixtures";
import { ADDRESS_ZERO, MAX_UINT_256, ZERO } from "@utils/constants";

const expect = getWaffleExpect();

describe("Compound", () => {
  let owner: Account;
  let deployer: DeployHelper;

  let compoundLib: Compound;
  let compoundLibMock: CompoundMock;
  let invokeLibMock: InvokeMock;
  let setup: SystemFixture;
  let compoundSetup: CompoundFixture;

  let cEther: CEther;
  let cDai: CERc20;
  let ckToken: CKToken;

  before(async () => {
    [
      owner,
    ] = await getAccounts();

    deployer = new DeployHelper(owner.wallet);
    setup = getSystemFixture(owner.address);
    await setup.initialize();

    compoundLib = await deployer.libraries.deployCompound();
    compoundLibMock = await deployer.mocks.deployCompoundMock(
      "contracts/protocol/integration/lib/Compound.sol:Compound",
      compoundLib.address
    );
    invokeLibMock = await deployer.mocks.deployInvokeMock();
    await setup.controller.addModule(compoundLibMock.address);
    await setup.controller.addModule(invokeLibMock.address);

    compoundSetup = getCompoundFixture(owner.address);
    await compoundSetup.initialize();

    cEther = await compoundSetup.createAndEnableCEther(
      ether(200000000),
      compoundSetup.comptroller.address,
      compoundSetup.interestRateModel.address,
      "Compound ether",
      "cETH",
      8,
      ether(0.75), // 75% collateral factor
      ether(1000)
    );

    cDai = await compoundSetup.createAndEnableCToken(
      setup.dai.address,
      ether(200000000),
      compoundSetup.comptroller.address,
      compoundSetup.interestRateModel.address,
      "Compound Dai",
      "cDAI",
      8,
      ether(0.75), // 75% collateral factor
      ether(1)
    );

    // Mint cTokens
    await setup.weth.approve(cEther.address, MAX_UINT_256);
    await cEther.mint({value: ether(100)});
    await setup.dai.approve(cDai.address, MAX_UINT_256);
    await cDai.mint(ether(1000));

    ckToken = await setup.createCKToken(
      [cEther.address, cDai.address, setup.dai.address, setup.weth.address],
      [bitcoin(1), bitcoin(100), ether(100), ether(1)],
      [setup.issuanceModule.address, compoundLibMock.address, invokeLibMock.address]
    );

    await setup.issuanceModule.initialize(ckToken.address, ADDRESS_ZERO);
    await compoundLibMock.initializeModuleOnCK(ckToken.address);
    await invokeLibMock.initializeModuleOnCK(ckToken.address);

    await cEther.approve(setup.issuanceModule.address, MAX_UINT_256);
    await cDai.approve(setup.issuanceModule.address, MAX_UINT_256);
    await setup.dai.approve(setup.issuanceModule.address, MAX_UINT_256);
    await setup.weth.approve(setup.issuanceModule.address, MAX_UINT_256);
    await setup.issuanceModule.issue(ckToken.address, ether(1), owner.address);
  });

  addSnapshotBeforeRestoreAfterEach();

  describe("#getEnterMarketsCalldata", async () => {
    let subjectCToken: Address;
    let subjectComptroller: Address;

    beforeEach(async () => {
      subjectCToken = cDai.address;
      subjectComptroller = compoundSetup.comptroller.address;
    });

    async function subject(): Promise<any> {
      return compoundLibMock.testGetEnterMarketsCalldata(
        subjectCToken,
        subjectComptroller,
      );
    }

    it("should get correct data", async () => {
      const [target, value, calldata] = await subject();
      const expectedCalldata = compoundSetup.comptroller.interface.encodeFunctionData("enterMarkets", [
        [cDai.address],
      ]);

      expect(target).to.eq(subjectComptroller);
      expect(value).to.eq(ZERO);
      expect(calldata).to.eq(expectedCalldata);
    });
  });

  describe("#invokeEnterMarkets", async () => {
    let subjectCKToken: Address;
    let subjectCToken: Address;
    let subjectComptroller: Address;

    beforeEach(async () => {
      subjectCKToken = ckToken.address;
      subjectCToken = cDai.address;
      subjectComptroller = compoundSetup.comptroller.address;
    });

    async function subject(): Promise<any> {
      return compoundLibMock.testInvokeEnterMarkets(
        subjectCKToken,
        subjectCToken,
        subjectComptroller,
      );
    }

    it("should enter markets", async () => {
      await subject();
      const isCDaiEntered = await compoundSetup.comptroller.checkMembership(ckToken.address, cDai.address);
      expect(isCDaiEntered).to.be.true;
    });

    describe("when entering market fails", async () => {
      beforeEach(async () => {
        await compoundSetup.comptroller._setMaxAssets(0);
      });

      afterEach(async () => {
        await compoundSetup.comptroller._setMaxAssets(10);
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Entering failed");
      });
    });
  });

  describe("#getExitMarketCalldata", async () => {
    let subjectCToken: Address;
    let subjectComptroller: Address;

    beforeEach(async () => {
      subjectCToken = cDai.address;
      subjectComptroller = compoundSetup.comptroller.address;
    });

    async function subject(): Promise<any> {
      return compoundLibMock.testGetExitMarketCalldata(
        subjectCToken,
        subjectComptroller,
      );
    }

    it("should get correct data", async () => {
      const [target, value, calldata] = await subject();
      const expectedCalldata = compoundSetup.comptroller.interface.encodeFunctionData("exitMarket", [
        cDai.address,
      ]);

      expect(target).to.eq(subjectComptroller);
      expect(value).to.eq(ZERO);
      expect(calldata).to.eq(expectedCalldata);
    });
  });

  describe("#invokeExitMarket", async () => {
    let subjectCKToken: Address;
    let subjectCToken: Address;
    let subjectComptroller: Address;

    beforeEach(async () => {
      await compoundLibMock.testInvokeEnterMarkets(ckToken.address, cDai.address, compoundSetup.comptroller.address);

      subjectCKToken = ckToken.address;
      subjectCToken = cDai.address;
      subjectComptroller = compoundSetup.comptroller.address;
    });

    async function subject(): Promise<any> {
      return compoundLibMock.testInvokeExitMarket(
        subjectCKToken,
        subjectCToken,
        subjectComptroller,
      );
    }

    it("should exit", async () => {
      await subject();
      const isCDaiEntered = await compoundSetup.comptroller.checkMembership(ckToken.address, cDai.address);
      expect(isCDaiEntered).to.be.false;
    });

    describe("when exiting market fails", async () => {
      beforeEach(async () => {
        await compoundLibMock.testInvokeBorrow(ckToken.address, cDai.address, ether(0.1));
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Exiting failed");
      });
    });
  });

  describe("#getMintCEtherCalldata", async () => {
    let subjectCToken: Address;
    let subjectQuantity: BigNumber;

    beforeEach(async () => {
      subjectCToken = cEther.address;
      subjectQuantity = ether(1);
    });

    async function subject(): Promise<any> {
      return compoundLibMock.testGetMintCEtherCalldata(
        subjectCToken,
        subjectQuantity,
      );
    }

    it("should get correct data", async () => {
      const [target, value, calldata] = await subject();
      const expectedCalldata = cEther.interface.encodeFunctionData("mint");

      expect(target).to.eq(subjectCToken);
      expect(value).to.eq(subjectQuantity);
      expect(calldata).to.eq(expectedCalldata);
    });
  });

  describe("#invokeMintCEther", async () => {
    let subjectCKToken: Address;
    let subjectCToken: Address;
    let subjectQuantity: BigNumber;

    beforeEach(async () => {
      await owner.wallet.sendTransaction({to: ckToken.address, value: ether(0.01)});
      subjectCKToken = ckToken.address;
      subjectCToken = cEther.address;
      subjectQuantity = ether(0.01);
    });

    async function subject(): Promise<any> {
      return compoundLibMock.testInvokeMintCEther(
        subjectCKToken,
        subjectCToken,
        subjectQuantity,
      );
    }

    it("should mint cEther", async () => {
      const previousCTokenBalance = await cEther.balanceOf(ckToken.address);
      await subject();
      const currentCTokenBalance = await cEther.balanceOf(ckToken.address);
      const exchangeRate = await cEther.exchangeRateStored();
      const expectedCTokenBalance = preciseDiv(subjectQuantity, exchangeRate).add(previousCTokenBalance);
      expect(currentCTokenBalance).to.eq(expectedCTokenBalance);
    });
  });

  describe("#getMintCTokenCalldata", async () => {
    let subjectCToken: Address;
    let subjectQuantity: BigNumber;

    beforeEach(async () => {
      subjectCToken = cDai.address;
      subjectQuantity = ether(1);
    });

    async function subject(): Promise<any> {
      return compoundLibMock.testGetMintCTokenCalldata(
        subjectCToken,
        subjectQuantity,
      );
    }

    it("should get correct data", async () => {
      const [target, value, calldata] = await subject();
      const expectedCalldata = cDai.interface.encodeFunctionData("mint", [subjectQuantity]);

      expect(target).to.eq(subjectCToken);
      expect(value).to.eq(subjectQuantity);
      expect(calldata).to.eq(expectedCalldata);
    });
  });

  describe("#invokeMintCToken", async () => {
    let subjectCKToken: Address;
    let subjectCToken: Address;
    let subjectQuantity: BigNumber;

    beforeEach(async () => {
      await invokeLibMock.testInvokeApprove(ckToken.address, setup.dai.address, cDai.address, MAX_UINT_256);

      subjectCKToken = ckToken.address;
      subjectCToken = cDai.address;
      subjectQuantity = ether(1);
    });

    async function subject(): Promise<any> {
      return compoundLibMock.testInvokeMintCToken(
        subjectCKToken,
        subjectCToken,
        subjectQuantity,
      );
    }

    it("should mint cToken", async () => {
      const previousCTokenBalance = await cDai.balanceOf(ckToken.address);
      await subject();
      const currentCTokenBalance = await cDai.balanceOf(ckToken.address);
      const exchangeRate = await cDai.exchangeRateStored();
      const expectedCTokenBalance = preciseDiv(subjectQuantity, exchangeRate).add(previousCTokenBalance);
      expect(currentCTokenBalance).to.eq(expectedCTokenBalance);
    });

    describe("when minting fails", async () => {
      beforeEach(async () => {
        await invokeLibMock.testInvokeApprove(ckToken.address, setup.dai.address, cDai.address, ZERO);
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Mint failed");
      });
    });
  });

  describe("#getRedeemUnderlyingCalldata", async () => {
    let subjectCToken: Address;
    let subjectQuantity: BigNumber;

    beforeEach(async () => {
      subjectCToken = cDai.address;
      subjectQuantity = ether(1);
    });

    async function subject(): Promise<any> {
      return compoundLibMock.testGetRedeemUnderlyingCalldata(
        subjectCToken,
        subjectQuantity,
      );
    }

    it("should get correct data", async () => {
      const [target, value, calldata] = await subject();
      const expectedCalldata = cDai.interface.encodeFunctionData("redeemUnderlying", [subjectQuantity]);

      expect(target).to.eq(subjectCToken);
      expect(value).to.eq(subjectQuantity);
      expect(calldata).to.eq(expectedCalldata);
    });
  });

  describe("#invokeRedeemUnderlying", async () => {
    let subjectCKToken: Address;
    let subjectCToken: Address;
    let subjectQuantity: BigNumber;

    beforeEach(async () => {
      subjectCKToken = ckToken.address;
      subjectCToken = cDai.address;
      subjectQuantity = ether(1);
    });

    async function subject(): Promise<any> {
      return compoundLibMock.testInvokeRedeemUnderlying(
        subjectCKToken,
        subjectCToken,
        subjectQuantity,
      );
    }

    it("should redeem cToken", async () => {
      const previousCTokenBalance = await cDai.balanceOf(ckToken.address);
      await subject();
      const currentCTokenBalance = await cDai.balanceOf(ckToken.address);
      const exchangeRate = await cDai.exchangeRateStored();
      const expectedCTokenBalance = previousCTokenBalance.sub(preciseDiv(subjectQuantity, exchangeRate));
      expect(currentCTokenBalance).to.eq(expectedCTokenBalance);
    });

    describe("when redeeming underlying return data is a nonzero value", async () => {
      beforeEach(async () => {
        // Set redeem quantity to more than account liquidity
        subjectQuantity = ether(10000);
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Redeem underlying failed");
      });
    });
  });

  describe("#getRedeemCalldata", async () => {
    let subjectCToken: Address;
    let subjectQuantity: BigNumber;

    beforeEach(async () => {
      subjectCToken = cDai.address;
      subjectQuantity = ether(1);
    });

    async function subject(): Promise<any> {
      return compoundLibMock.testGetRedeemCalldata(
        subjectCToken,
        subjectQuantity,
      );
    }

    it("should get correct data", async () => {
      const [target, value, calldata] = await subject();
      const expectedCalldata = cDai.interface.encodeFunctionData("redeem", [subjectQuantity]);

      expect(target).to.eq(subjectCToken);
      expect(value).to.eq(subjectQuantity);
      expect(calldata).to.eq(expectedCalldata);
    });
  });

  describe("#invokeRedeem", async () => {
    let subjectCKToken: Address;
    let subjectCToken: Address;
    let subjectQuantity: BigNumber;

    beforeEach(async () => {
      subjectCKToken = ckToken.address;
      subjectCToken = cDai.address;
      const exchangeRate = await cDai.exchangeRateStored();
      subjectQuantity = preciseDiv(ether(1), exchangeRate);
    });

    async function subject(): Promise<any> {
      return compoundLibMock.testInvokeRedeem(
        subjectCKToken,
        subjectCToken,
        subjectQuantity,
      );
    }

    it("should redeem cToken", async () => {
      const previousCTokenBalance = await cDai.balanceOf(ckToken.address);
      await subject();
      const currentCTokenBalance = await cDai.balanceOf(ckToken.address);
      const expectedCTokenBalance = previousCTokenBalance.sub(subjectQuantity);
      expect(currentCTokenBalance).to.eq(expectedCTokenBalance);
    });

    describe("when redeeming return data is a nonzero value", async () => {
      beforeEach(async () => {
        // Set redeem quantity to more than account liquidity
        subjectQuantity = ether(10000);
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Redeem failed");
      });
    });
  });

  describe("#getRepayBorrowCEtherCalldata", async () => {
    let subjectCToken: Address;
    let subjectQuantity: BigNumber;

    beforeEach(async () => {
      subjectCToken = cEther.address;
      subjectQuantity = ether(1);
    });

    async function subject(): Promise<any> {
      return compoundLibMock.testGetRepayBorrowCEtherCalldata(
        subjectCToken,
        subjectQuantity,
      );
    }

    it("should get correct data", async () => {
      const [target, value, calldata] = await subject();
      const expectedCalldata = cEther.interface.encodeFunctionData("repayBorrow");

      expect(target).to.eq(subjectCToken);
      expect(value).to.eq(subjectQuantity);
      expect(calldata).to.eq(expectedCalldata);
    });
  });

  describe("#invokeRepayBorrowCEther", async () => {
    let subjectCKToken: Address;
    let subjectCToken: Address;
    let subjectQuantity: BigNumber;

    beforeEach(async () => {
      await compoundLibMock.testInvokeEnterMarkets(
        ckToken.address,
        cEther.address,
        compoundSetup.comptroller.address
      );
      await compoundLibMock.testInvokeBorrow(ckToken.address, cEther.address, ether(0.01));

      subjectCKToken = ckToken.address;
      subjectCToken = cEther.address;
      subjectQuantity = ether(0.01);
    });

    async function subject(): Promise<any> {
      return compoundLibMock.testInvokeRepayBorrowCEther(
        subjectCKToken,
        subjectCToken,
        subjectQuantity,
      );
    }

    it("should repay cEther", async () => {
      const previousEthBalance = await getEthBalance(ckToken.address);
      await subject();
      const currentEthBalance = await getEthBalance(ckToken.address);
      const expectedEthBalance = previousEthBalance.sub(subjectQuantity);
      expect(currentEthBalance).to.eq(expectedEthBalance);
    });
  });

  describe("#getRepayBorrowCTokenCalldata", async () => {
    let subjectCToken: Address;
    let subjectQuantity: BigNumber;

    beforeEach(async () => {
      subjectCToken = cDai.address;
      subjectQuantity = ether(1);
    });

    async function subject(): Promise<any> {
      return compoundLibMock.testGetRepayBorrowCTokenCalldata(
        subjectCToken,
        subjectQuantity,
      );
    }

    it("should get correct data", async () => {
      const [target, value, calldata] = await subject();
      const expectedCalldata = cDai.interface.encodeFunctionData("repayBorrow", [subjectQuantity]);

      expect(target).to.eq(subjectCToken);
      expect(value).to.eq(subjectQuantity);
      expect(calldata).to.eq(expectedCalldata);
    });
  });

  describe("#invokeRepayBorrowCToken", async () => {
    let subjectCKToken: Address;
    let subjectCToken: Address;
    let subjectQuantity: BigNumber;

    beforeEach(async () => {
      await invokeLibMock.testInvokeApprove(ckToken.address, setup.dai.address, cDai.address, MAX_UINT_256);
      await compoundLibMock.testInvokeEnterMarkets(
        ckToken.address,
        cDai.address,
        compoundSetup.comptroller.address
      );
      await compoundLibMock.testInvokeBorrow(ckToken.address, cDai.address, ether(1));

      subjectCKToken = ckToken.address;
      subjectCToken = cDai.address;
      subjectQuantity = ether(1);
    });

    async function subject(): Promise<any> {
      return compoundLibMock.testInvokeRepayBorrowCToken(
        subjectCKToken,
        subjectCToken,
        subjectQuantity,
      );
    }

    it("should repay cToken", async () => {
      const previousDaiBalance = await setup.dai.balanceOf(ckToken.address);
      await subject();
      const currentDaiBalance = await setup.dai.balanceOf(ckToken.address);
      const expectedDaiBalance = previousDaiBalance.sub(subjectQuantity);
      expect(currentDaiBalance).to.eq(expectedDaiBalance);
    });

    describe("when repay fails", async () => {
      beforeEach(async () => {
        await invokeLibMock.testInvokeApprove(ckToken.address, setup.dai.address, cDai.address, ZERO);
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Repay failed");
      });
    });
  });

  describe("#getBorrowCalldata", async () => {
    let subjectCToken: Address;
    let subjectQuantity: BigNumber;

    beforeEach(async () => {
      subjectCToken = cDai.address;
      subjectQuantity = ether(1);
    });

    async function subject(): Promise<any> {
      return compoundLibMock.testGetBorrowCalldata(
        subjectCToken,
        subjectQuantity,
      );
    }

    it("should get correct data", async () => {
      const [target, value, calldata] = await subject();
      const expectedCalldata = cDai.interface.encodeFunctionData("borrow", [subjectQuantity]);

      expect(target).to.eq(subjectCToken);
      expect(value).to.eq(ZERO);
      expect(calldata).to.eq(expectedCalldata);
    });
  });

  describe("#invokeBorrow", async () => {
    let subjectCKToken: Address;
    let subjectCToken: Address;
    let subjectQuantity: BigNumber;

    beforeEach(async () => {
      await compoundLibMock.testInvokeEnterMarkets(
        ckToken.address,
        cDai.address,
        compoundSetup.comptroller.address
      );
      subjectCKToken = ckToken.address;
      subjectCToken = cDai.address;
      subjectQuantity = ether(1);
    });

    async function subject(): Promise<any> {
      return compoundLibMock.testInvokeBorrow(
        subjectCKToken,
        subjectCToken,
        subjectQuantity,
      );
    }

    it("should borrow cToken", async () => {
      const previousBorrowBalance = await setup.dai.balanceOf(ckToken.address);
      await subject();
      const currentBorrowBalance = await setup.dai.balanceOf(ckToken.address);
      const expectedBorrowBalance = previousBorrowBalance.add(subjectQuantity);
      expect(currentBorrowBalance).to.eq(expectedBorrowBalance);
    });

    describe("when borrow fails", async () => {
      beforeEach(async () => {
        subjectQuantity = ether(10000);
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Borrow failed");
      });
    });
  });
});
