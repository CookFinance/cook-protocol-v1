import "module-alias/register";
import { BigNumber } from "@ethersproject/bignumber";

import { Address, StreamingFeeState } from "@utils/types";
import { Account } from "@utils/test/types";
import { ADDRESS_ZERO, ZERO, ONE, TWO, ONE_YEAR_IN_SECONDS } from "@utils/constants";
import { ProtocolViewer, CKToken } from "@utils/contracts";
import DeployHelper from "@utils/deploys";
import {
  ether,
  getStreamingFee,
} from "@utils/index";
import {
  addSnapshotBeforeRestoreAfterEach,
  getAccounts,
  getWaffleExpect,
  getSystemFixture,
  getLastBlockTimestamp,
  increaseTimeAsync
} from "@utils/test/index";
import { SystemFixture } from "@utils/fixtures";

const expect = getWaffleExpect();

describe("ProtocolViewer", () => {
  let owner: Account;
  let dummyModule: Account;
  let pendingModule: Account;
  let managerOne: Account;
  let managerTwo: Account;

  let deployer: DeployHelper;
  let setup: SystemFixture;

  let viewer: ProtocolViewer;

  let ckTokenOne: CKToken;
  let ckTokenTwo: CKToken;

  before(async () => {
    [
      owner,
      dummyModule,
      managerOne,
      managerTwo,
      pendingModule,
    ] = await getAccounts();

    deployer = new DeployHelper(owner.wallet);
    setup = getSystemFixture(owner.address);
    await setup.initialize();
    await setup.controller.addModule(dummyModule.address);

    viewer = await deployer.viewers.deployProtocolViewer();

    ckTokenOne = await setup.createCKToken(
      [setup.weth.address],
      [ether(1)],
      [setup.issuanceModule.address, setup.streamingFeeModule.address, dummyModule.address],
      managerOne.address,
      "FirstCKToken",
      "ONE"
    );

    ckTokenTwo = await setup.createCKToken(
      [setup.wbtc.address],
      [ether(1)],
      [setup.issuanceModule.address, setup.streamingFeeModule.address],
      managerTwo.address,
      "SecondCKToken",
      "TWO"
    );

    const streamingFeeStateOne = {
      feeRecipient: managerOne.address,
      maxStreamingFeePercentage: ether(.1),
      streamingFeePercentage: ether(.02),
      lastStreamingFeeTimestamp: ZERO,
    } as StreamingFeeState;
    const streamingFeeStateTwo = {
      feeRecipient: managerTwo.address,
      maxStreamingFeePercentage: ether(.1),
      streamingFeePercentage: ether(.04),
      lastStreamingFeeTimestamp: ZERO,
    } as StreamingFeeState;
    await setup.streamingFeeModule.connect(managerOne.wallet).initialize(ckTokenOne.address, streamingFeeStateOne);
    await setup.streamingFeeModule.connect(managerTwo.wallet).initialize(ckTokenTwo.address, streamingFeeStateTwo);

    await setup.issuanceModule.connect(managerOne.wallet).initialize(ckTokenOne.address, ADDRESS_ZERO);
  });

  addSnapshotBeforeRestoreAfterEach();

  describe("#batchFetchModuleStates", async () => {
    let subjectCKTokens: Address[];
    let subjectModules: Address[];

    beforeEach(async () => {
      subjectCKTokens = [ckTokenOne.address, ckTokenTwo.address];
      subjectModules = [setup.issuanceModule.address, setup.streamingFeeModule.address, dummyModule.address];
    });

    async function subject(): Promise<any> {
      return viewer.batchFetchModuleStates(subjectCKTokens, subjectModules);
    }

    it("should return the correct module states", async () => {
      const [ckOneStates, ckTwoStates] = await subject();

      const ckOneExpectedStates = [BigNumber.from(2), BigNumber.from(2), ONE];
      const ckTwoExpectedStates = [ONE, BigNumber.from(2), ZERO];

      expect(ckOneStates[0]).to.eq(ckOneExpectedStates[0]);
      expect(ckOneStates[1]).to.eq(ckOneExpectedStates[1]);
      expect(ckOneStates[2]).to.eq(ckOneExpectedStates[2]);
      expect(ckTwoStates[0]).to.eq(ckTwoExpectedStates[0]);
      expect(ckTwoStates[1]).to.eq(ckTwoExpectedStates[1]);
      expect(ckTwoStates[2]).to.eq(ckTwoExpectedStates[2]);
    });
  });

  describe("#batchFetchManagers", async () => {
    let subjectCKTokens: Address[];

    beforeEach(async () => {
      subjectCKTokens = [ckTokenOne.address, ckTokenTwo.address];
    });

    async function subject(): Promise<any> {
      return viewer.batchFetchManagers(subjectCKTokens);
    }

    it("should return the correct managers", async () => {
      const managers = await subject();

      expect(managers[0]).to.eq(managerOne.address);
      expect(managers[1]).to.eq(managerTwo.address);
    });
  });

  describe("#batchFetchStreamingFeeInfo", async () => {
    let subjectStreamingFeeModule: Address;
    let subjectCKTokens: Address[];

    let subjectTimeFastForward: BigNumber;

    beforeEach(async () => {
      subjectStreamingFeeModule = setup.streamingFeeModule.address;
      subjectCKTokens = [ckTokenOne.address, ckTokenTwo.address];
      subjectTimeFastForward = ONE_YEAR_IN_SECONDS;
    });

    async function subject(): Promise<any> {
      await increaseTimeAsync(subjectTimeFastForward);
      return viewer.batchFetchStreamingFeeInfo(subjectStreamingFeeModule, subjectCKTokens);
    }

    it("should return the correct streaming fee info", async () => {
      const feeStateOne = await setup.streamingFeeModule.feeStates(subjectCKTokens[0]);
      const feeStateTwo = await setup.streamingFeeModule.feeStates(subjectCKTokens[1]);

      const [ckOneFeeInfo, ckTwoFeeInfo] = await subject();

      const callTimestamp = await getLastBlockTimestamp();

      const expectedFeePercentOne = await getStreamingFee(
        setup.streamingFeeModule,
        subjectCKTokens[0],
        feeStateOne.lastStreamingFeeTimestamp,
        callTimestamp
      );
      const expectedFeePercentTwo = await getStreamingFee(
        setup.streamingFeeModule,
        subjectCKTokens[1],
        feeStateTwo.lastStreamingFeeTimestamp,
        callTimestamp
      );

      expect(ckOneFeeInfo.feeRecipient).to.eq(managerOne.address);
      expect(ckTwoFeeInfo.feeRecipient).to.eq(managerTwo.address);
      expect(ckOneFeeInfo.streamingFeePercentage).to.eq(ether(.02));
      expect(ckTwoFeeInfo.streamingFeePercentage).to.eq(ether(.04));
      expect(ckOneFeeInfo.unaccruedFees).to.eq(expectedFeePercentOne);
      expect(ckTwoFeeInfo.unaccruedFees).to.eq(expectedFeePercentTwo);
    });
  });

  describe("#getCKDetails", async () => {
    let subjectCKToken: Address;
    let subjectModules: Address[];

    beforeEach(async () => {
      await setup.controller.addModule(pendingModule.address);
      await ckTokenTwo.connect(managerTwo.wallet).addModule(pendingModule.address);

      subjectCKToken = ckTokenTwo.address;
      subjectModules = [
        dummyModule.address,
        setup.streamingFeeModule.address,
        setup.issuanceModule.address,
        pendingModule.address,
      ];
    });

    async function subject(): Promise<any> {
      return viewer.getCKDetails(subjectCKToken, subjectModules);
    }

    it("should return the correct CK details", async () => {
      const details: any = await subject();

      const name = await ckTokenTwo.name();
      expect(details.name).to.eq(name);

      const symbol = await ckTokenTwo.symbol();
      expect(details.symbol).to.eq(symbol);

      const manager = await ckTokenTwo.manager();
      expect(details.manager).to.eq(manager);

      const modules = await ckTokenTwo.getModules();
      expect(JSON.stringify(details.modules)).to.eq(JSON.stringify(modules));

      const expectedStatuses = [ZERO.toNumber(), TWO.toNumber(), ONE.toNumber(), ONE.toNumber()];
      expect(JSON.stringify(details.moduleStatuses)).to.eq(JSON.stringify(expectedStatuses));

      const positions = await ckTokenTwo.getPositions();
      expect(JSON.stringify(details.positions)).to.eq(JSON.stringify(positions));

      const totalSupply = await ckTokenTwo.totalSupply();
      expect(details.totalSupply).to.eq(totalSupply);
    });
  });

  describe("#batchFetchDetails", async () => {
    let subjectCKTokenAddresses: Address[];
    let subjectModules: Address[];

    beforeEach(async () => {
      await setup.controller.addModule(pendingModule.address);
      await ckTokenOne.connect(managerOne.wallet).addModule(pendingModule.address);
      await ckTokenTwo.connect(managerTwo.wallet).addModule(pendingModule.address);

      subjectCKTokenAddresses = [ckTokenOne.address, ckTokenTwo.address];
      subjectModules = [
        dummyModule.address,
        setup.streamingFeeModule.address,
        setup.issuanceModule.address,
        pendingModule.address,
      ];
    });

    async function subject(): Promise<any> {
      return viewer.batchFetchDetails(subjectCKTokenAddresses, subjectModules);
    }

    it("should return the correct CK details", async () => {
      const [ckOneDetails, ckTwoDetails]: any = await subject();

      const ckOneName = await ckTokenOne.name();
      const ckTwoName = await ckTokenTwo.name();
      expect(ckOneDetails.name).to.eq(ckOneName);
      expect(ckTwoDetails.name).to.eq(ckTwoName);

      const ckOneSymbol = await ckTokenOne.symbol();
      const ckTwoSymbol = await ckTokenTwo.symbol();
      expect(ckOneDetails.symbol).to.eq(ckOneSymbol);
      expect(ckTwoDetails.symbol).to.eq(ckTwoSymbol);

      const ckOneManager = await ckTokenOne.manager();
      const ckTwoManager = await ckTokenTwo.manager();
      expect(ckOneDetails.manager).to.eq(ckOneManager);
      expect(ckTwoDetails.manager).to.eq(ckTwoManager);

      const ckOneModules = await ckTokenOne.getModules();
      const ckTwoModules = await ckTokenTwo.getModules();
      expect(JSON.stringify(ckOneDetails.modules)).to.eq(JSON.stringify(ckOneModules));
      expect(JSON.stringify(ckTwoDetails.modules)).to.eq(JSON.stringify(ckTwoModules));

      const expectedTokenOneStatuses = [ONE.toNumber(), TWO.toNumber(), TWO.toNumber(), ONE.toNumber()];
      const expectTokenTwoStatuses = [ZERO.toNumber(), TWO.toNumber(), ONE.toNumber(), ONE.toNumber()];
      expect(JSON.stringify(ckOneDetails.moduleStatuses)).to.eq(JSON.stringify(expectedTokenOneStatuses));
      expect(JSON.stringify(ckTwoDetails.moduleStatuses)).to.eq(JSON.stringify(expectTokenTwoStatuses));

      const ckOnePositions = await ckTokenOne.getPositions();
      const ckTwoPositions = await ckTokenTwo.getPositions();
      expect(JSON.stringify(ckOneDetails.positions)).to.eq(JSON.stringify(ckOnePositions));
      expect(JSON.stringify(ckTwoDetails.positions)).to.eq(JSON.stringify(ckTwoPositions));

      const ckOneTotalSupply = await ckTokenOne.totalSupply();
      const ckTwoTotalSupply = await ckTokenTwo.totalSupply();
      expect(ckOneDetails.totalSupply).to.eq(ckOneTotalSupply);
      expect(ckTwoDetails.totalSupply).to.eq(ckTwoTotalSupply);
    });
  });

  describe("#batchFetchBalancesOf", async () => {
    let subjectTokenAddresses: Address[];
    let subjectOwnerAddresses: Address[];

    beforeEach(async () => {
      subjectTokenAddresses = [setup.usdc.address, setup.dai.address];
      subjectOwnerAddresses = [owner.address, managerOne.address];
    });

    async function subject(): Promise<any> {
      return viewer.batchFetchBalancesOf(subjectTokenAddresses, subjectOwnerAddresses);
    }

    it("should return the correct set details", async () => {
      const [balanceOne, balanceTwo]: any = await subject();

      const expectedUSDCBalance = await setup.usdc.connect(owner.wallet).balanceOf(owner.address);
      expect(balanceOne).to.eq(expectedUSDCBalance);

      const expectedDAIBalance = await setup.dai.connect(owner.wallet).balanceOf(managerOne.address);
      expect(balanceTwo).to.eq(expectedDAIBalance);
    });
  });

  describe("#batchFetchAllowances", async () => {
    let subjectTokenAddresses: Address[];
    let subjectOwnerAddresses: Address[];
    let subjectSpenderAddresses: Address[];

    beforeEach(async () => {
      const usdcApprovalAmount = ether(3);
      await setup.usdc.approve(managerOne.address, usdcApprovalAmount);

      const daiApprovalAmount = ether(2);
      await setup.dai.approve(managerTwo.address, daiApprovalAmount);

      subjectTokenAddresses = [setup.usdc.address, setup.dai.address];
      subjectOwnerAddresses = [owner.address, owner.address];
      subjectSpenderAddresses = [managerOne.address, managerTwo.address];
    });

    async function subject(): Promise<any> {
      return viewer.batchFetchAllowances(
        subjectTokenAddresses,
        subjectOwnerAddresses,
        subjectSpenderAddresses
      );
    }

    it("should return the correct allowances", async () => {
      const [allowanceOne, allowanceTwo]: any = await subject();

      const expectedUSDCAllowance = await setup.usdc.allowance(
        owner.address,
        managerOne.address
      );
      expect(allowanceOne).to.eq(expectedUSDCAllowance);

      const expectedDAIAllowance = await setup.dai.allowance(
        owner.address,
        managerTwo.address
      );
      expect(allowanceTwo).to.eq(expectedDAIAllowance);
    });
  });
});
