import "module-alias/register";
import { BigNumber } from "@ethersproject/bignumber";

import { Address, ContractTransaction } from "@utils/types";
import { Account } from "@utils/test/types";
import { ZERO, PRECISE_UNIT, ADDRESS_ZERO } from "@utils/constants";
import { AirdropModule, CKToken } from "@utils/contracts";
import DeployHelper from "@utils/deploys";
import {
  ether,
  preciseMul,
  preciseDiv,
} from "@utils/index";
import {
  addSnapshotBeforeRestoreAfterEach,
  getAccounts,
  getWaffleExpect,
  getSystemFixture,
  getRandomAddress,
} from "@utils/test/index";
import { SystemFixture } from "@utils/fixtures";
import { AirdropSettings } from "@utils/types";

const expect = getWaffleExpect();

describe("AirdropModule", () => {
  let owner: Account;
  let feeRecipient: Account;
  let tokenHolder: Account;
  let deployer: DeployHelper;
  let setup: SystemFixture;

  let ckToken: CKToken;
  let airdropModule: AirdropModule;

  before(async () => {
    [
      owner,
      feeRecipient,
      tokenHolder,
    ] = await getAccounts();

    deployer = new DeployHelper(owner.wallet);
    setup = getSystemFixture(owner.address);
    await setup.initialize();

    airdropModule = await deployer.modules.deployAirdropModule(setup.controller.address);
    await setup.controller.addModule(airdropModule.address);
  });

  addSnapshotBeforeRestoreAfterEach();

  describe("#initialize", async () => {
    let airdrops: Address[];
    let airdropFee: BigNumber;
    let anyoneAbsorb: boolean;

    let subjectCKToken: Address;
    let subjectAirdropSettings: AirdropSettings;
    let subjectCaller: Account;

    before(async () => {
      airdrops = [setup.usdc.address, setup.weth.address];
      airdropFee = ether(.2);
      anyoneAbsorb = true;
    });

    beforeEach(async () => {
      ckToken = await setup.createCKToken(
        [setup.weth.address],
        [ether(1)],
        [airdropModule.address]
      );

      subjectCKToken = ckToken.address;
      subjectAirdropSettings = {
        airdrops,
        feeRecipient: feeRecipient.address,
        airdropFee,
        anyoneAbsorb,
      } as AirdropSettings;
      subjectCaller = owner;
    });

    async function subject(): Promise<ContractTransaction> {
      airdropModule = airdropModule.connect(subjectCaller.wallet);
      return airdropModule.initialize(subjectCKToken, subjectAirdropSettings);
    }

    it("should set the correct airdrops and anyoneAbsorb fields", async () => {
      await subject();

      const airdropSettings: any = await airdropModule.airdropSettings(subjectCKToken);
      const airdrops = await airdropModule.getAirdrops(subjectCKToken);

      expect(JSON.stringify(airdrops)).to.eq(JSON.stringify(airdrops));
      expect(airdropSettings.airdropFee).to.eq(airdropFee);
      expect(airdropSettings.anyoneAbsorb).to.eq(anyoneAbsorb);
    });

    describe("when the airdrops array is empty", async () => {
      before(async () => {
        airdrops = [];
      });

      after(async () => {
        airdrops = [setup.usdc.address, setup.weth.address];
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("At least one token must be passed.");
      });
    });

    describe("when the airdrop fee is greater than 100%", async () => {
      before(async () => {
        airdropFee = ether(1.01);
      });

      after(async () => {
        airdropFee = ether(.2);
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Fee must be <= 100%.");
      });
    });

    describe("when the caller is not the CKToken manager", async () => {
      beforeEach(async () => {
        subjectCaller = tokenHolder;
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Must be the CKToken manager");
      });
    });

    describe("when module is in NONE state", async () => {
      beforeEach(async () => {
        await subject();
        await ckToken.removeModule(airdropModule.address);
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Must be pending initialization");
      });
    });

    describe("when module is in INITIALIZED state", async () => {
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
          [setup.weth.address],
          [ether(1)],
          [airdropModule.address]
        );

        subjectCKToken = nonEnabledCKToken.address;
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Must be controller-enabled CKToken");
      });
    });
  });

  describe("#batchAbsorb", async () => {
    let airdrops: Address[];
    let airdropFee: BigNumber;
    let anyoneAbsorb: boolean;

    let airdropAmounts: BigNumber[];
    let protocolFee: BigNumber;
    let isInitialized: boolean;

    let subjectCKToken: Address;
    let subjectTokens: Address[];
    let subjectCaller: Account;

    before(async () => {
      airdrops = [setup.usdc.address, setup.weth.address];
      airdropFee = ether(.2);
      anyoneAbsorb = true;

      protocolFee = ether(.15);
      airdropAmounts = [BigNumber.from(10 ** 10), ether(2)];
      isInitialized = true;
    });

    beforeEach(async () => {
      await setup.controller.addFee(airdropModule.address, ZERO, protocolFee);
      ckToken = await setup.createCKToken(
        [setup.weth.address],
        [ether(1)],
        [airdropModule.address, setup.issuanceModule.address]
      );

      await setup.issuanceModule.initialize(ckToken.address, ADDRESS_ZERO);
      if (isInitialized) {
        const airdropSettings = {
          airdrops,
          feeRecipient: feeRecipient.address,
          airdropFee,
          anyoneAbsorb,
        };
        await airdropModule.connect(owner.wallet).initialize(ckToken.address, airdropSettings);
      }

      await setup.issuanceModule.issue(ckToken.address, ether(1.124), owner.address);

      await setup.usdc.transfer(ckToken.address, airdropAmounts[0]);
      await setup.weth.transfer(ckToken.address, airdropAmounts[1]);

      subjectCKToken = ckToken.address;
      subjectTokens = [setup.usdc.address, setup.weth.address];
      subjectCaller = tokenHolder;
    });

    async function subject(): Promise<ContractTransaction> {
      return airdropModule.connect(subjectCaller.wallet).batchAbsorb(subjectCKToken, subjectTokens);
    }

    it("should create the correct new usdc position", async () => {
      const totalSupply = await ckToken.totalSupply();
      const preDropBalance = ZERO;
      const balance = await setup.usdc.balanceOf(ckToken.address);

      await subject();

      const airdroppedTokens = balance.sub(preDropBalance);
      const netBalance = balance.sub(preciseMul(airdroppedTokens, airdropFee));

      const positions = await ckToken.getPositions();
      expect(positions[1].unit).to.eq(preciseDiv(netBalance, totalSupply));
    });

    it("should transfer the correct usdc amount to the ckToken feeRecipient", async () => {
      const preDropBalance = ZERO;
      const balance = await setup.usdc.balanceOf(ckToken.address);

      await subject();

      const airdroppedTokens = balance.sub(preDropBalance);
      const expectedManagerTake = preciseMul(preciseMul(airdroppedTokens, airdropFee), PRECISE_UNIT.sub(protocolFee));

      const actualManagerTake = await setup.usdc.balanceOf(feeRecipient.address);
      expect(actualManagerTake).to.eq(expectedManagerTake);
    });

    it("should transfer the correct usdc amount to the protocol feeRecipient", async () => {
      const preDropBalance = ZERO;
      const balance = await setup.usdc.balanceOf(ckToken.address);

      await subject();

      const airdroppedTokens = balance.sub(preDropBalance);
      const expectedProtocolTake = preciseMul(preciseMul(airdroppedTokens, airdropFee), protocolFee);
      const actualProtocolTake = await setup.usdc.balanceOf(setup.feeRecipient);
      expect(actualProtocolTake).to.eq(expectedProtocolTake);
    });

    it("should emit the correct ComponentAbsorbed event for USDC", async () => {
      const preDropBalance = ZERO;
      const balance = await setup.usdc.balanceOf(ckToken.address);

      const airdroppedTokens = balance.sub(preDropBalance);
      const expectedManagerTake = preciseMul(preciseMul(airdroppedTokens, airdropFee), PRECISE_UNIT.sub(protocolFee));
      const expectedProtocolTake = preciseMul(preciseMul(airdroppedTokens, airdropFee), protocolFee);
      await expect(subject()).to.emit(airdropModule, "ComponentAbsorbed").withArgs(
        ckToken.address,
        setup.usdc.address,
        airdroppedTokens,
        expectedManagerTake,
        expectedProtocolTake
      );
    });

    it("should create the correct new eth position", async () => {
      const totalSupply = await ckToken.totalSupply();
      const prePositions = await ckToken.getPositions();
      const preDropBalance = preciseMul(prePositions[0].unit, totalSupply);
      const balance = await setup.weth.balanceOf(ckToken.address);

      await subject();

      const airdroppedTokens = balance.sub(preDropBalance);
      const netBalance = balance.sub(preciseMul(airdroppedTokens, airdropFee));

      const positions = await ckToken.getPositions();
      expect(positions[0].unit).to.eq(preciseDiv(netBalance, totalSupply));
    });

    it("should transfer the correct weth amount to the ckToken feeRecipient", async () => {
      const totalSupply = await ckToken.totalSupply();
      const prePositions = await ckToken.getPositions();
      const preDropBalance = preciseMul(prePositions[0].unit, totalSupply);
      const balance = await setup.weth.balanceOf(ckToken.address);

      await subject();

      const airdroppedTokens = balance.sub(preDropBalance);
      const expectedManagerTake = preciseMul(preciseMul(airdroppedTokens, airdropFee), PRECISE_UNIT.sub(protocolFee));

      const actualManagerTake = await setup.weth.balanceOf(feeRecipient.address);
      expect(actualManagerTake).to.eq(expectedManagerTake);
    });

    it("should transfer the correct weth amount to the protocol feeRecipient", async () => {
      const totalSupply = await ckToken.totalSupply();
      const prePositions = await ckToken.getPositions();
      const preDropBalance = preciseMul(prePositions[0].unit, totalSupply);
      const balance = await setup.weth.balanceOf(ckToken.address);

      await subject();

      const airdroppedTokens = balance.sub(preDropBalance);
      const expectedProtocolTake = preciseMul(preciseMul(airdroppedTokens, airdropFee), protocolFee);

      const actualProtocolTake = await setup.weth.balanceOf(setup.feeRecipient);
      expect(actualProtocolTake).to.eq(expectedProtocolTake);
    });

    it("should emit the correct ComponentAbsorbed event for WETH", async () => {
      const totalSupply = await ckToken.totalSupply();
      const prePositions = await ckToken.getPositions();
      const preDropBalance = preciseMul(prePositions[0].unit, totalSupply);
      const balance = await setup.weth.balanceOf(ckToken.address);

      const airdroppedTokens = balance.sub(preDropBalance);
      const expectedManagerTake = preciseMul(preciseMul(airdroppedTokens, airdropFee), PRECISE_UNIT.sub(protocolFee));
      const expectedProtocolTake = preciseMul(preciseMul(airdroppedTokens, airdropFee), protocolFee);
      await expect(subject()).to.emit(airdropModule, "ComponentAbsorbed").withArgs(
        ckToken.address,
        setup.weth.address,
        airdroppedTokens,
        expectedManagerTake,
        expectedProtocolTake
      );
    });


    describe("when protocolFee is 0 but airdropFee > 0", async () => {
      before(async () => {
        protocolFee = ZERO;
      });

      after(async () => {
        protocolFee = ether(.15);
      });

      it("should create the correct new usdc position", async () => {
        const totalSupply = await ckToken.totalSupply();
        const preDropBalance = ZERO;
        const balance = await setup.usdc.balanceOf(ckToken.address);

        await subject();

        const airdroppedTokens = balance.sub(preDropBalance);
        const netBalance = balance.sub(preciseMul(airdroppedTokens, airdropFee));

        const positions = await ckToken.getPositions();
        expect(positions[1].unit).to.eq(preciseDiv(netBalance, totalSupply));
      });

      it("should transfer the correct usdc amount to the ckToken feeRecipient", async () => {
        const preDropBalance = ZERO;
        const balance = await setup.usdc.balanceOf(ckToken.address);

        await subject();

        const airdroppedTokens = balance.sub(preDropBalance);
        const expectedManagerTake = preciseMul(preciseMul(airdroppedTokens, airdropFee), PRECISE_UNIT.sub(protocolFee));

        const actualManagerTake = await setup.usdc.balanceOf(feeRecipient.address);
        expect(actualManagerTake).to.eq(expectedManagerTake);
      });

      it("should transfer nothing to the protocol feeRecipient", async () => {
        const preDropBalance = ZERO;

        await subject();

        const actualProtocolTake = await setup.usdc.balanceOf(setup.feeRecipient);
        expect(actualProtocolTake).to.eq(preDropBalance);
      });

      it("should create the correct new eth position", async () => {
        const totalSupply = await ckToken.totalSupply();
        const prePositions = await ckToken.getPositions();
        const preDropBalance = preciseMul(prePositions[0].unit, totalSupply);
        const balance = await setup.weth.balanceOf(ckToken.address);

        await subject();

        const airdroppedTokens = balance.sub(preDropBalance);
        const netBalance = balance.sub(preciseMul(airdroppedTokens, airdropFee));

        const positions = await ckToken.getPositions();
        expect(positions[0].unit).to.eq(preciseDiv(netBalance, totalSupply));
      });

      it("should transfer the correct weth amount to the ckToken feeRecipient", async () => {
        const totalSupply = await ckToken.totalSupply();
        const prePositions = await ckToken.getPositions();
        const preDropBalance = preciseMul(prePositions[0].unit, totalSupply);
        const balance = await setup.weth.balanceOf(ckToken.address);

        await subject();

        const airdroppedTokens = balance.sub(preDropBalance);
        const expectedManagerTake = preciseMul(preciseMul(airdroppedTokens, airdropFee), PRECISE_UNIT.sub(protocolFee));

        const actualManagerTake = await setup.weth.balanceOf(feeRecipient.address);
        expect(actualManagerTake).to.eq(expectedManagerTake);
      });

      it("should transfer nothing to the protocol feeRecipient", async () => {
        const preDropBalance = await setup.weth.balanceOf(feeRecipient.address);

        await subject();

        const actualProtocolTake = await setup.weth.balanceOf(setup.feeRecipient);
        expect(actualProtocolTake).to.eq(preDropBalance);
      });
    });

    describe("when airdropFee is 0", async () => {
      before(async () => {
        airdropFee = ZERO;
      });

      after(async () => {
        airdropFee = ether(.15);
      });

      it("should create the correct new usdc position", async () => {
        const totalSupply = await ckToken.totalSupply();
        const preDropBalance = ZERO;
        const balance = await setup.usdc.balanceOf(ckToken.address);

        await subject();

        const airdroppedTokens = balance.sub(preDropBalance);
        const netBalance = balance.sub(preciseMul(airdroppedTokens, airdropFee));

        const positions = await ckToken.getPositions();
        expect(positions[1].unit).to.eq(preciseDiv(netBalance, totalSupply));
      });

      it("should transfer nothing to the CKToken feeRecipient", async () => {
        const preDropBalance = ZERO;

        await subject();

        const actualProtocolTake = await setup.usdc.balanceOf(setup.feeRecipient);
        expect(actualProtocolTake).to.eq(preDropBalance);
      });

      it("should transfer nothing to the protocol feeRecipient", async () => {
        const preDropBalance = ZERO;

        await subject();

        const actualProtocolTake = await setup.usdc.balanceOf(setup.feeRecipient);
        expect(actualProtocolTake).to.eq(preDropBalance);
      });

      it("should create the correct new eth position", async () => {
        const totalSupply = await ckToken.totalSupply();
        const prePositions = await ckToken.getPositions();
        const preDropBalance = preciseMul(prePositions[0].unit, totalSupply);
        const balance = await setup.weth.balanceOf(ckToken.address);

        await subject();

        const airdroppedTokens = balance.sub(preDropBalance);
        const netBalance = balance.sub(preciseMul(airdroppedTokens, airdropFee));

        const positions = await ckToken.getPositions();
        expect(positions[0].unit).to.eq(preciseDiv(netBalance, totalSupply));
      });

      it("should transfer nothing to the ckToken feeRecipient", async () => {
        const preDropBalance = await setup.weth.balanceOf(feeRecipient.address);

        await subject();

        const actualProtocolTake = await setup.weth.balanceOf(setup.feeRecipient);
        expect(actualProtocolTake).to.eq(preDropBalance);
      });

      it("should transfer nothing to the protocol feeRecipient", async () => {
        const preDropBalance = await setup.weth.balanceOf(feeRecipient.address);

        await subject();

        const actualProtocolTake = await setup.weth.balanceOf(setup.feeRecipient);
        expect(actualProtocolTake).to.eq(preDropBalance);
      });
    });

    describe("when anyoneAbsorb is false and the caller is the CKToken manager", async () => {
      before(async () => {
        anyoneAbsorb = false;
      });

      beforeEach(async () => {
        subjectCaller = owner;
      });

      after(async () => {
        anyoneAbsorb = true;
      });

      it("should create the correct new usdc position", async () => {
        const totalSupply = await ckToken.totalSupply();
        const preDropBalance = ZERO;
        const balance = await setup.usdc.balanceOf(ckToken.address);

        await subject();

        const airdroppedTokens = balance.sub(preDropBalance);
        const netBalance = balance.sub(preciseMul(airdroppedTokens, airdropFee));

        const positions = await ckToken.getPositions();
        expect(positions[1].unit).to.eq(preciseDiv(netBalance, totalSupply));
      });

      it("should create the correct new eth position", async () => {
        const totalSupply = await ckToken.totalSupply();
        const prePositions = await ckToken.getPositions();
        const preDropBalance = preciseMul(prePositions[0].unit, totalSupply);
        const balance = await setup.weth.balanceOf(ckToken.address);

        await subject();

        const airdroppedTokens = balance.sub(preDropBalance);
        const netBalance = balance.sub(preciseMul(airdroppedTokens, airdropFee));

        const positions = await ckToken.getPositions();
        expect(positions[0].unit).to.eq(preciseDiv(netBalance, totalSupply));
      });
    });

    describe("when a passed token is not enabled by the manager", async () => {
      beforeEach(async () => {
        subjectTokens = [setup.usdc.address, setup.wbtc.address];
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Must be approved token.");
      });
    });

    describe("when anyoneAbsorb is false and the caller is not the CKToken manager", async () => {
      before(async () => {
        anyoneAbsorb = false;
      });

      after(async () => {
        anyoneAbsorb = true;
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Must be valid caller");
      });
    });

    describe("when module is not initialized", async () => {
      before(async () => {
        isInitialized = false;
      });

      beforeEach(async () => {
        subjectCaller = owner;
      });

      after(async () => {
        isInitialized = true;
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Must be a valid and initialized CKToken");
      });
    });

    describe("when CKToken is not valid", async () => {
      beforeEach(async () => {
        const nonEnabledCKToken = await setup.createNonControllerEnabledCKToken(
          [setup.weth.address],
          [ether(1)],
          [airdropModule.address]
        );

        subjectCKToken = nonEnabledCKToken.address;
        subjectCaller = owner;
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Must be a valid and initialized CKToken");
      });
    });
  });

  describe("#absorb", async () => {
    let airdrops: Address[];
    let airdropFee: BigNumber;
    let anyoneAbsorb: boolean;

    let airdropAmounts: BigNumber[];
    let protocolFee: BigNumber;
    let isInitialized: boolean;

    let subjectCKToken: Address;
    let subjectToken: Address;
    let subjectCaller: Account;

    before(async () => {
      airdrops = [setup.usdc.address, setup.weth.address];
      airdropFee = ether(.2);
      anyoneAbsorb = true;

      protocolFee = ether(.15);
      airdropAmounts = [BigNumber.from(10 ** 10), ether(2)];
      isInitialized = true;
    });

    beforeEach(async () => {
      await setup.controller.addFee(airdropModule.address, ZERO, protocolFee);
      ckToken = await setup.createCKToken(
        [setup.weth.address],
        [ether(1)],
        [airdropModule.address, setup.issuanceModule.address]
      );

      await setup.issuanceModule.initialize(ckToken.address, ADDRESS_ZERO);
      if (isInitialized) {
        const airdropSettings = {
          airdrops,
          feeRecipient: feeRecipient.address,
          airdropFee,
          anyoneAbsorb,
        };
        await airdropModule.connect(owner.wallet).initialize(ckToken.address, airdropSettings);
      }

      await setup.issuanceModule.issue(ckToken.address, ether(1.124), owner.address);

      await setup.usdc.transfer(ckToken.address, airdropAmounts[0]);
      await setup.weth.transfer(ckToken.address, airdropAmounts[1]);

      subjectCKToken = ckToken.address;
      subjectToken = setup.usdc.address;
      subjectCaller = tokenHolder;
    });

    async function subject(): Promise<ContractTransaction> {
      return airdropModule.connect(subjectCaller.wallet).absorb(subjectCKToken, subjectToken);
    }

    it("should create the correct new usdc position", async () => {
      const totalSupply = await ckToken.totalSupply();
      const preDropBalance = ZERO;
      const balance = await setup.usdc.balanceOf(ckToken.address);

      await subject();

      const airdroppedTokens = balance.sub(preDropBalance);
      const netBalance = balance.sub(preciseMul(airdroppedTokens, airdropFee));

      const positions = await ckToken.getPositions();
      expect(positions[1].unit).to.eq(preciseDiv(netBalance, totalSupply));
    });

    it("should transfer the correct usdc amount to the ckToken feeRecipient", async () => {
      const preDropBalance = ZERO;
      const balance = await setup.usdc.balanceOf(ckToken.address);

      await subject();

      const airdroppedTokens = balance.sub(preDropBalance);
      const expectedManagerTake = preciseMul(preciseMul(airdroppedTokens, airdropFee), PRECISE_UNIT.sub(protocolFee));

      const actualManagerTake = await setup.usdc.balanceOf(feeRecipient.address);
      expect(actualManagerTake).to.eq(expectedManagerTake);
    });

    it("should transfer the correct usdc amount to the protocol feeRecipient", async () => {
      const preDropBalance = ZERO;
      const balance = await setup.usdc.balanceOf(ckToken.address);

      await subject();

      const airdroppedTokens = balance.sub(preDropBalance);
      const expectedProtocolTake = preciseMul(preciseMul(airdroppedTokens, airdropFee), protocolFee);
      const actualProtocolTake = await setup.usdc.balanceOf(setup.feeRecipient);
      expect(actualProtocolTake).to.eq(expectedProtocolTake);
    });

    it("should emit the correct ComponentAbsorbed event for USDC", async () => {
      const preDropBalance = ZERO;
      const balance = await setup.usdc.balanceOf(ckToken.address);

      const airdroppedTokens = balance.sub(preDropBalance);
      const expectedManagerTake = preciseMul(preciseMul(airdroppedTokens, airdropFee), PRECISE_UNIT.sub(protocolFee));
      const expectedProtocolTake = preciseMul(preciseMul(airdroppedTokens, airdropFee), protocolFee);
      await expect(subject()).to.emit(airdropModule, "ComponentAbsorbed").withArgs(
        ckToken.address,
        setup.usdc.address,
        airdroppedTokens,
        expectedManagerTake,
        expectedProtocolTake
      );
    });

    describe("when protocolFee is 0 but airdropFee > 0", async () => {
      before(async () => {
        protocolFee = ZERO;
      });

      after(async () => {
        protocolFee = ether(.15);
      });

      it("should create the correct new usdc position", async () => {
        const totalSupply = await ckToken.totalSupply();
        const preDropBalance = ZERO;
        const balance = await setup.usdc.balanceOf(ckToken.address);

        await subject();

        const airdroppedTokens = balance.sub(preDropBalance);
        const netBalance = balance.sub(preciseMul(airdroppedTokens, airdropFee));

        const positions = await ckToken.getPositions();
        expect(positions[1].unit).to.eq(preciseDiv(netBalance, totalSupply));
      });

      it("should transfer the correct usdc amount to the ckToken feeRecipient", async () => {
        const preDropBalance = ZERO;
        const balance = await setup.usdc.balanceOf(ckToken.address);

        await subject();

        const airdroppedTokens = balance.sub(preDropBalance);
        const expectedManagerTake = preciseMul(preciseMul(airdroppedTokens, airdropFee), PRECISE_UNIT.sub(protocolFee));

        const actualManagerTake = await setup.usdc.balanceOf(feeRecipient.address);
        expect(actualManagerTake).to.eq(expectedManagerTake);
      });

      it("should transfer nothing to the protocol feeRecipient", async () => {
        const preDropBalance = ZERO;

        await subject();

        const actualProtocolTake = await setup.usdc.balanceOf(setup.feeRecipient);
        expect(actualProtocolTake).to.eq(preDropBalance);
      });
    });

    describe("when airdropFee is 0", async () => {
      before(async () => {
        airdropFee = ZERO;
      });

      after(async () => {
        airdropFee = ether(.15);
      });

      it("should create the correct new usdc position", async () => {
        const totalSupply = await ckToken.totalSupply();
        const preDropBalance = ZERO;
        const balance = await setup.usdc.balanceOf(ckToken.address);

        await subject();

        const airdroppedTokens = balance.sub(preDropBalance);
        const netBalance = balance.sub(preciseMul(airdroppedTokens, airdropFee));

        const positions = await ckToken.getPositions();
        expect(positions[1].unit).to.eq(preciseDiv(netBalance, totalSupply));
      });

      it("should transfer nothing to the ckToken feeRecipient", async () => {
        const preDropBalance = ZERO;

        await subject();

        const actualProtocolTake = await setup.usdc.balanceOf(setup.feeRecipient);
        expect(actualProtocolTake).to.eq(preDropBalance);
      });

      it("should transfer nothing to the protocol feeRecipient", async () => {
        const preDropBalance = ZERO;

        await subject();

        const actualProtocolTake = await setup.usdc.balanceOf(setup.feeRecipient);
        expect(actualProtocolTake).to.eq(preDropBalance);
      });
    });

    describe("when anyoneAbsorb is false and the caller is the CKToken manager", async () => {
      before(async () => {
        anyoneAbsorb = false;
      });

      beforeEach(async () => {
        subjectCaller = owner;
      });

      after(async () => {
        anyoneAbsorb = true;
      });

      it("should create the correct new usdc position", async () => {
        const totalSupply = await ckToken.totalSupply();
        const preDropBalance = ZERO;
        const balance = await setup.usdc.balanceOf(ckToken.address);

        await subject();

        const airdroppedTokens = balance.sub(preDropBalance);
        const netBalance = balance.sub(preciseMul(airdroppedTokens, airdropFee));

        const positions = await ckToken.getPositions();
        expect(positions[1].unit).to.eq(preciseDiv(netBalance, totalSupply));
      });
    });

    describe("when anyoneAbsorb is false and the caller is not the CKToken manager", async () => {
      before(async () => {
        anyoneAbsorb = false;
      });

      after(async () => {
        anyoneAbsorb = true;
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Must be valid caller");
      });
    });

    describe("when passed token is not an approved airdrop", async () => {
      beforeEach(async () => {
        subjectToken = setup.wbtc.address;
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Must be approved token.");
      });
    });

    describe("when module is not initialized", async () => {
      before(async () => {
        isInitialized = false;
      });

      beforeEach(async () => {
        subjectCaller = owner;
      });

      after(async () => {
        isInitialized = true;
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Must be a valid and initialized CKToken");
      });
    });

    describe("when CKToken is not valid", async () => {
      beforeEach(async () => {
        const nonEnabledCKToken = await setup.createNonControllerEnabledCKToken(
          [setup.weth.address],
          [ether(1)],
          [airdropModule.address]
        );

        subjectCKToken = nonEnabledCKToken.address;
        subjectCaller = owner;
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Must be a valid and initialized CKToken");
      });
    });
  });

  describe("#removeModule", async () => {
    let ckToken: CKToken;

    let subjectModule: Address;

    beforeEach(async () => {
      ckToken = await setup.createCKToken(
        [setup.weth.address],
        [ether(1)],
        [airdropModule.address]
      );

      const airdrops = [setup.usdc.address, setup.weth.address];
      const airdropFee = ether(.2);
      const anyoneAbsorb = true;
      const airdropSettings = {
        airdrops,
        feeRecipient: feeRecipient.address,
        airdropFee,
        anyoneAbsorb,
      };
      await airdropModule.connect(owner.wallet).initialize(ckToken.address, airdropSettings);
      subjectModule = airdropModule.address;
    });

    async function subject(): Promise<any> {
      return ckToken.removeModule(subjectModule);
    }

    it("should delete the airdropSettings", async () => {
      await subject();
      const airdropSettings: any = await airdropModule.airdropSettings(ckToken.address);
      const airdrops = await airdropModule.getAirdrops(ckToken.address);

      expect(airdrops).to.be.empty;
      expect(airdropSettings.airdropFee).to.eq(ZERO);
      expect(airdropSettings.anyoneAbsorb).to.be.false;
    });
  });

  describe("CONTEXT: Airdrop add/remove", async () => {
    let ckToken: CKToken;
    let isInitialized: boolean;

    let subjectCKToken: Address;
    let subjectAirdrop: Address;
    let subjectCaller: Account;

    before(async () => {
      isInitialized = true;
    });

    beforeEach(async () => {
      ckToken = await setup.createCKToken(
        [setup.weth.address],
        [ether(1)],
        [airdropModule.address]
      );

      const airdrops = [setup.usdc.address, setup.weth.address];
      const airdropFee = ether(.2);
      const anyoneAbsorb = true;

      if (isInitialized) {
        const airdropSettings = {
          airdrops,
          feeRecipient: feeRecipient.address,
          airdropFee,
          anyoneAbsorb,
        };
        await airdropModule.connect(owner.wallet).initialize(ckToken.address, airdropSettings);
      }
    });

    describe("#addAirdrop", async () => {
      beforeEach(async () => {
        subjectCKToken = ckToken.address;
        subjectAirdrop = setup.wbtc.address;
        subjectCaller = owner;
      });

      async function subject(): Promise<any> {
        airdropModule = airdropModule.connect(subjectCaller.wallet);
        return airdropModule.addAirdrop(subjectCKToken, subjectAirdrop);
      }

      it("should add the new token", async () => {
        await subject();

        const airdrops = await airdropModule.getAirdrops(ckToken.address);
        expect(airdrops[2]).to.eq(subjectAirdrop);
      });

      describe("when airdrop has already been added", async () => {
        beforeEach(async () => {
          subjectAirdrop = setup.usdc.address;
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Token already added.");
        });
      });

      describe("when module is not initialized", async () => {
        before(async () => {
          isInitialized = false;
        });

        after(async () => {
          isInitialized = true;
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Must be a valid and initialized CKToken");
        });
      });

      describe("when CKToken is not valid", async () => {
        beforeEach(async () => {
          const nonEnabledCKToken = await setup.createNonControllerEnabledCKToken(
            [setup.weth.address],
            [ether(1)],
            [airdropModule.address]
          );

          subjectCKToken = nonEnabledCKToken.address;
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Must be a valid and initialized CKToken");
        });
      });
    });

    describe("#removeAirdrop", async () => {
      beforeEach(async () => {
        subjectCKToken = ckToken.address;
        subjectAirdrop = setup.usdc.address;
        subjectCaller = owner;
      });

      async function subject(): Promise<any> {
        airdropModule = airdropModule.connect(subjectCaller.wallet);
        return airdropModule.removeAirdrop(subjectCKToken, subjectAirdrop);
      }

      it("should remove the token", async () => {
        await subject();

        const airdrops = await airdropModule.getAirdrops(ckToken.address);
        expect(airdrops).to.not.contain(subjectAirdrop);
      });

      describe("when airdrop is not in the airdrops array", async () => {
        beforeEach(async () => {
          subjectAirdrop = setup.wbtc.address;
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Token not added.");
        });
      });

      describe("when module is not initialized", async () => {
        before(async () => {
          isInitialized = false;
        });

        after(async () => {
          isInitialized = true;
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Must be a valid and initialized CKToken");
        });
      });

      describe("when CKToken is not valid", async () => {
        beforeEach(async () => {
          const nonEnabledCKToken = await setup.createNonControllerEnabledCKToken(
            [setup.weth.address],
            [ether(1)],
            [airdropModule.address]
          );

          subjectCKToken = nonEnabledCKToken.address;
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Must be a valid and initialized CKToken");
        });
      });
    });
  });

  describe("#updateAirdropFee", async () => {
    let airdrops: Address[];
    let airdropFee: BigNumber;
    let anyoneAbsorb: boolean;

    let airdropAmounts: BigNumber[];
    let protocolFee: BigNumber;
    let isInitialized: boolean;

    let subjectCKToken: Address;
    let subjectNewFee: BigNumber;
    let subjectCaller: Account;

    before(async () => {
      airdrops = [setup.usdc.address, setup.weth.address];
      airdropFee = ether(.2);
      anyoneAbsorb = true;

      protocolFee = ether(.15);
      airdropAmounts = [BigNumber.from(10 ** 10), ether(2)];
      isInitialized = true;
    });

    beforeEach(async () => {
      await setup.controller.addFee(airdropModule.address, ZERO, protocolFee);
      ckToken = await setup.createCKToken(
        [setup.weth.address],
        [ether(1)],
        [airdropModule.address, setup.issuanceModule.address]
      );

      await setup.issuanceModule.initialize(ckToken.address, ADDRESS_ZERO);
      if (isInitialized) {
        const airdropSettings = {
          airdrops,
          feeRecipient: feeRecipient.address,
          airdropFee,
          anyoneAbsorb,
        };
        await airdropModule.connect(owner.wallet).initialize(ckToken.address, airdropSettings);
      }

      await setup.issuanceModule.issue(ckToken.address, ether(1.124), owner.address);

      await setup.usdc.transfer(ckToken.address, airdropAmounts[0]);

      subjectCKToken = ckToken.address;
      subjectNewFee = ether(.5);
      subjectCaller = owner;
    });

    async function subject(): Promise<ContractTransaction> {
      return airdropModule.connect(subjectCaller.wallet).updateAirdropFee(subjectCKToken, subjectNewFee);
    }

    it("should create the correct new usdc position", async () => {
      const totalSupply = await ckToken.totalSupply();
      const preDropBalance = ZERO;
      const balance = await setup.usdc.balanceOf(ckToken.address);

      await subject();

      const airdroppedTokens = balance.sub(preDropBalance);
      const netBalance = balance.sub(preciseMul(airdroppedTokens, airdropFee));

      const positions = await ckToken.getPositions();
      expect(positions[1].unit).to.eq(preciseDiv(netBalance, totalSupply));
    });

    it("should set the new fee", async () => {
      await subject();

      const airdropSettings = await airdropModule.airdropSettings(ckToken.address);
      expect(airdropSettings.airdropFee).to.eq(subjectNewFee);
    });

    describe("when new fee exceeds 100%", async () => {
      beforeEach(async () => {
        subjectNewFee = ether(1.1);
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Airdrop fee can't exceed 100%");
      });
    });

    describe("when module is not initialized", async () => {
      before(async () => {
        isInitialized = false;
      });

      after(async () => {
        isInitialized = true;
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Must be a valid and initialized CKToken");
      });
    });

    describe("when CKToken is not valid", async () => {
      beforeEach(async () => {
        const nonEnabledCKToken = await setup.createNonControllerEnabledCKToken(
          [setup.weth.address],
          [ether(1)],
          [airdropModule.address]
        );

        subjectCKToken = nonEnabledCKToken.address;
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Must be a valid and initialized CKToken");
      });
    });
  });

  describe("#updateAnyoneAbsorb", async () => {
    let ckToken: CKToken;
    let isInitialized: boolean;

    let subjectCKToken: Address;
    let subjectCaller: Account;

    before(async () => {
      isInitialized = true;
    });

    beforeEach(async () => {
      ckToken = await setup.createCKToken(
        [setup.weth.address],
        [ether(1)],
        [airdropModule.address]
      );

      const airdrops = [setup.usdc.address, setup.weth.address];
      const airdropFee = ether(.2);
      const anyoneAbsorb = true;

      if (isInitialized) {
        const airdropSettings = {
          airdrops,
          feeRecipient: feeRecipient.address,
          airdropFee,
          anyoneAbsorb,
        };
        await airdropModule.connect(owner.wallet).initialize(ckToken.address, airdropSettings);
      }

      subjectCKToken = ckToken.address;
      subjectCaller = owner;
    });

    async function subject(): Promise<any> {
      airdropModule = airdropModule.connect(subjectCaller.wallet);
      return airdropModule.updateAnyoneAbsorb(subjectCKToken);
    }

    it("should flip the anyoneAbsorb indicator", async () => {
      await subject();

      const airdropSettings = await airdropModule.airdropSettings(ckToken.address);
      expect(airdropSettings.anyoneAbsorb).to.be.false;
    });

    describe("when module is not initialized", async () => {
      before(async () => {
        isInitialized = false;
      });

      after(async () => {
        isInitialized = true;
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Must be a valid and initialized CKToken");
      });
    });

    describe("when CKToken is not valid", async () => {
      beforeEach(async () => {
        const nonEnabledCKToken = await setup.createNonControllerEnabledCKToken(
          [setup.weth.address],
          [ether(1)],
          [airdropModule.address]
        );

        subjectCKToken = nonEnabledCKToken.address;
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Must be a valid and initialized CKToken");
      });
    });
  });

  describe("#updateFeeRecipient", async () => {
    let ckToken: CKToken;
    let isInitialized: boolean;

    let subjectCKToken: Address;
    let subjectNewFeeRecipient: Address;
    let subjectCaller: Account;

    before(async () => {
      isInitialized = true;
    });

    beforeEach(async () => {
      ckToken = await setup.createCKToken(
        [setup.weth.address],
        [ether(1)],
        [airdropModule.address]
      );

      const airdrops = [setup.usdc.address, setup.weth.address];
      const airdropFee = ether(.2);
      const anyoneAbsorb = true;

      if (isInitialized) {
        const airdropSettings = {
          airdrops,
          feeRecipient: feeRecipient.address,
          airdropFee,
          anyoneAbsorb,
        };
        await airdropModule.connect(owner.wallet).initialize(ckToken.address, airdropSettings);
      }

      subjectCKToken = ckToken.address;
      subjectNewFeeRecipient = await getRandomAddress();
      subjectCaller = owner;
    });

    async function subject(): Promise<any> {
      airdropModule = airdropModule.connect(subjectCaller.wallet);
      return airdropModule.updateFeeRecipient(subjectCKToken, subjectNewFeeRecipient);
    }

    it("should change the fee recipient to the new address", async () => {
      await subject();

      const airdropSettings = await airdropModule.airdropSettings(ckToken.address);
      expect(airdropSettings.feeRecipient).to.eq(subjectNewFeeRecipient);
    });

    describe("when passed address is zero", async () => {
      beforeEach(async () => {
        subjectNewFeeRecipient = ADDRESS_ZERO;
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Passed address must be non-zero");
      });
    });

    describe("when module is not initialized", async () => {
      before(async () => {
        isInitialized = false;
      });

      after(async () => {
        isInitialized = true;
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Must be a valid and initialized CKToken");
      });
    });

    describe("when CKToken is not valid", async () => {
      beforeEach(async () => {
        const nonEnabledCKToken = await setup.createNonControllerEnabledCKToken(
          [setup.weth.address],
          [ether(1)],
          [airdropModule.address]
        );

        subjectCKToken = nonEnabledCKToken.address;
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Must be a valid and initialized CKToken");
      });
    });
  });

  describe("#getAirdrops", async () => {
    let ckToken: CKToken;
    let airdrops: Address[];

    let subjectCKToken: Address;

    beforeEach(async () => {
      ckToken = await setup.createCKToken(
        [setup.weth.address],
        [ether(1)],
        [airdropModule.address]
      );

      airdrops = [setup.usdc.address, setup.weth.address];
      const airdropFee = ether(.2);
      const anyoneAbsorb = true;
      const airdropSettings = {
        airdrops,
        feeRecipient: feeRecipient.address,
        airdropFee,
        anyoneAbsorb,
      };
      await airdropModule.connect(owner.wallet).initialize(ckToken.address, airdropSettings);
      subjectCKToken = ckToken.address;
    });

    async function subject(): Promise<any> {
      return airdropModule.getAirdrops(subjectCKToken);
    }

    it("should return the airdops array", async () => {
      const actualAirdrops = await subject();

      expect(JSON.stringify(actualAirdrops)).to.eq(JSON.stringify(airdrops));
    });
  });

  describe("#isAirdrop", async () => {
    let subjectCKToken: Address;
    let subjectToken: Address;

    beforeEach(async () => {
      ckToken = await setup.createCKToken(
        [setup.weth.address],
        [ether(1)],
        [airdropModule.address]
      );

      const airdrops = [setup.usdc.address, setup.weth.address];
      const airdropFee = ether(.2);
      const anyoneAbsorb = true;
      const airdropSettings = {
        airdrops,
        feeRecipient: feeRecipient.address,
        airdropFee,
        anyoneAbsorb,
      };
      await airdropModule.connect(owner.wallet).initialize(ckToken.address, airdropSettings);

      subjectCKToken = ckToken.address;
      subjectToken = setup.usdc.address;
    });

    async function subject(): Promise<any> {
      return airdropModule.isAirdropToken(subjectCKToken, subjectToken);
    }

    it("should return true", async () => {
      const isAirdrop = await subject();

      expect(isAirdrop).to.be.true;
    });

    describe("when token not included in airdrops array", async () => {
      beforeEach(async () => {
        subjectToken = setup.wbtc.address;
      });

      it("should return true", async () => {
        const isAirdrop = await subject();

        expect(isAirdrop).to.be.false;
      });
    });
  });
});