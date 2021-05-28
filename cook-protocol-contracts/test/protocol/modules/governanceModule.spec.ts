import "module-alias/register";

import { Address, Bytes } from "@utils/types";
import { Account } from "@utils/test/types";
import { GovernanceModule, GovernanceAdapterMock, CKToken } from "@utils/contracts";
import DeployHelper from "@utils/deploys";
import {
  ether,
  bigNumberToData,
} from "@utils/index";
import {
  addSnapshotBeforeRestoreAfterEach,
  getAccounts,
  getWaffleExpect,
  getSystemFixture,
  getRandomAccount,
  getRandomAddress,
} from "@utils/test/index";
import { SystemFixture } from "@utils/fixtures";
import { BigNumber } from "@ethersproject/bignumber";
import { ADDRESS_ZERO, ONE, TWO, ZERO, EMPTY_BYTES } from "@utils/constants";

const expect = getWaffleExpect();

describe("GovernanceModule", () => {
  let owner: Account;
  let deployer: DeployHelper;
  let setup: SystemFixture;

  let governanceModule: GovernanceModule;
  let governanceAdapterMock: GovernanceAdapterMock;
  let governanceAdapterMock2: GovernanceAdapterMock;

  const governanceAdapterMockIntegrationName: string = "MOCK_GOV";
  const governanceAdapterMockIntegrationName2: string = "MOCK2_GOV";

  before(async () => {
    [
      owner,
    ] = await getAccounts();

    deployer = new DeployHelper(owner.wallet);
    setup = getSystemFixture(owner.address);
    await setup.initialize();

    governanceModule = await deployer.modules.deployGovernanceModule(setup.controller.address);
    await setup.controller.addModule(governanceModule.address);

    governanceAdapterMock = await deployer.mocks.deployGovernanceAdapterMock(ZERO);
    await setup.integrationRegistry.addIntegration(governanceModule.address, governanceAdapterMockIntegrationName, governanceAdapterMock.address);
    governanceAdapterMock2 = await deployer.mocks.deployGovernanceAdapterMock(ONE);
    await setup.integrationRegistry.addIntegration(governanceModule.address, governanceAdapterMockIntegrationName2, governanceAdapterMock2.address);
  });

  addSnapshotBeforeRestoreAfterEach();

  describe("#constructor", async () => {
    let subjectController: Address;

    beforeEach(async () => {
      subjectController = setup.controller.address;
    });

    async function subject(): Promise<any> {
      return deployer.modules.deployGovernanceModule(subjectController);
    }

    it("should set the correct controller", async () => {
      const governanceModule = await subject();

      const controller = await governanceModule.controller();
      expect(controller).to.eq(subjectController);
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
        [governanceModule.address]
      );
      subjectCKToken = ckToken.address;
      subjectCaller = owner;
    });

    async function subject(): Promise<any> {
      return governanceModule.connect(subjectCaller.wallet).initialize(subjectCKToken);
    }

    it("should enable the Module on the CKToken", async () => {
      await subject();
      const isModuleEnabled = await ckToken.isInitializedModule(governanceModule.address);
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

    describe("when module is in NONE state", async () => {
      beforeEach(async () => {
        await subject();
        await ckToken.removeModule(governanceModule.address);
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
          [governanceModule.address]
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
    let subjectModule: Address;
    let subjectCaller: Account;

    beforeEach(async () => {
      ckToken = await setup.createCKToken(
        [setup.weth.address],
        [ether(1)],
        [governanceModule.address]
      );

      subjectModule = governanceModule.address;
      subjectCaller = owner;

      await governanceModule.initialize(ckToken.address);
    });

    async function subject(): Promise<any> {
      return ckToken.connect(subjectCaller.wallet).removeModule(subjectModule);
    }

    it("should properly remove the module and settings", async () => {
      await subject();

      const isModuleEnabled = await ckToken.isInitializedModule(subjectModule);
      expect(isModuleEnabled).to.eq(false);
    });
  });

  describe("#vote", async () => {
    let ckToken: CKToken;
    let isInitialized: boolean;

    let subjectCaller: Account;
    let subjectIntegration: string;
    let subjectProposalId: BigNumber;
    let subjectSupport: boolean;
    let subjectCKToken: Address;
    let subjectData: Bytes;

    before(async () => {
      isInitialized = true;
    });

    beforeEach(async () => {
      ckToken = await setup.createCKToken(
        [setup.weth.address],
        [ether(1)],
        [governanceModule.address]
      );

      subjectCaller = owner;

      subjectProposalId = ZERO;
      subjectCKToken = ckToken.address;
      subjectIntegration = governanceAdapterMockIntegrationName;
      subjectSupport = true;
      subjectData = EMPTY_BYTES;

      if (isInitialized) {
        await governanceModule.initialize(ckToken.address);
      }
    });

    async function subject(): Promise<any> {
      return governanceModule.connect(subjectCaller.wallet).vote(
        subjectCKToken,
        subjectIntegration,
        subjectProposalId,
        subjectSupport,
        subjectData
      );
    }

    it("should vote in proposal for the governance integration", async () => {
      const proposalStatusBefore = await governanceAdapterMock.proposalToVote(subjectProposalId);
      expect(proposalStatusBefore).to.eq(false);

      await subject();

      const proposalStatusAfter = await governanceAdapterMock.proposalToVote(subjectProposalId);
      expect(proposalStatusAfter).to.eq(true);
    });

    it("emits the correct ProposalVoted event", async () => {
      await expect(subject()).to.emit(governanceModule, "ProposalVoted").withArgs(
        subjectCKToken,
        governanceAdapterMock.address,
        subjectProposalId,
        subjectSupport
      );
    });

    describe("when the governance integration is not present", async () => {
      beforeEach(async () => {
        subjectIntegration = await getRandomAddress();
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Must be valid adapter");
      });
    });

    describe("when caller is not manager", async () => {
      beforeEach(async () => {
        subjectCaller = await getRandomAccount();
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Must be the CKToken manager");
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
          [governanceModule.address]
        );

        subjectCKToken = nonEnabledCKToken.address;
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Must be a valid and initialized CKToken");
      });
    });
  });

  describe("#propose", async () => {
    let ckToken: CKToken;
    let isInitialized: boolean;

    let subjectCaller: Account;
    let subjectIntegration: string;
    let subjectCKToken: Address;
    let subjectProposalData: Bytes;

    before(async () => {
      isInitialized = true;
    });

    beforeEach(async () => {
      ckToken = await setup.createCKToken(
        [setup.weth.address],
        [ether(1)],
        [governanceModule.address]
      );

      // Get proposal data for mock governance adapter
      const proposalData = "0x" + bigNumberToData(TWO);

      subjectCaller = owner;

      subjectCKToken = ckToken.address;
      subjectIntegration = governanceAdapterMockIntegrationName;
      subjectProposalData = proposalData;

      if (isInitialized) {
        await governanceModule.initialize(ckToken.address);
      }
    });

    async function subject(): Promise<any> {
      return governanceModule.connect(subjectCaller.wallet).propose(
        subjectCKToken,
        subjectIntegration,
        subjectProposalData
      );
    }

    it("should create a new proposal for the governance integration", async () => {
      const proposalStatusBefore = await governanceAdapterMock.proposalCreated(TWO);
      expect(proposalStatusBefore).to.eq(false);

      await subject();

      const proposalStatusAfter = await governanceAdapterMock.proposalCreated(TWO);
      expect(proposalStatusAfter).to.eq(true);
    });

    it("emits the correct ProposalCreated event", async () => {
      await expect(subject()).to.emit(governanceModule, "ProposalCreated").withArgs(
        subjectCKToken,
        governanceAdapterMock.address,
        subjectProposalData
      );
    });

    describe("when the governance integration is not present", async () => {
      beforeEach(async () => {
        subjectIntegration = await getRandomAddress();
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Must be valid adapter");
      });
    });

    describe("when caller is not manager", async () => {
      beforeEach(async () => {
        subjectCaller = await getRandomAccount();
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Must be the CKToken manager");
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
          [governanceModule.address]
        );

        subjectCKToken = nonEnabledCKToken.address;
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Must be a valid and initialized CKToken");
      });
    });
  });

  describe("#delegate", async () => {
    let ckToken: CKToken;
    let isInitialized: boolean;

    let subjectCaller: Account;
    let subjectIntegration: string;
    let subjectCKToken: Address;
    let subjectDelegatee: Address;

    before(async () => {
      isInitialized = true;
    });

    beforeEach(async () => {
      ckToken = await setup.createCKToken(
        [setup.weth.address],
        [ether(1)],
        [governanceModule.address]
      );

      subjectCaller = owner;

      subjectCKToken = ckToken.address;
      subjectIntegration = governanceAdapterMockIntegrationName;
      subjectDelegatee = owner.address; // Delegate to owner

      if (isInitialized) {
        await governanceModule.initialize(ckToken.address);
      }
    });

    async function subject(): Promise<any> {
      return governanceModule.connect(subjectCaller.wallet).delegate(
        subjectCKToken,
        subjectIntegration,
        subjectDelegatee,
      );
    }

    it("should delegate to the correct ETH address", async () => {
      await subject();

      const delegatee = await governanceAdapterMock.delegatee();
      expect(delegatee).to.eq(subjectDelegatee);
    });

    it("emits the correct VoteDelegated event", async () => {
      await expect(subject()).to.emit(governanceModule, "VoteDelegated").withArgs(
        subjectCKToken,
        governanceAdapterMock.address,
        subjectDelegatee
      );
    });

    describe("when the governance integration is not present", async () => {
      beforeEach(async () => {
        subjectIntegration = await getRandomAddress();
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Must be valid adapter");
      });
    });

    describe("when caller is not manager", async () => {
      beforeEach(async () => {
        subjectCaller = await getRandomAccount();
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Must be the CKToken manager");
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
          [governanceModule.address]
        );

        subjectCKToken = nonEnabledCKToken.address;
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Must be a valid and initialized CKToken");
      });
    });
  });

  describe("#register", async () => {
    let ckToken: CKToken;
    let isInitialized: boolean;

    let subjectCaller: Account;
    let subjectIntegration: string;
    let subjectCKToken: Address;

    before(async () => {
      isInitialized = true;
    });

    beforeEach(async () => {
      ckToken = await setup.createCKToken(
        [setup.weth.address],
        [ether(1)],
        [governanceModule.address]
      );

      subjectCaller = owner;

      subjectCKToken = ckToken.address;
      subjectIntegration = governanceAdapterMockIntegrationName;

      if (isInitialized) {
        await governanceModule.initialize(ckToken.address);
      }
    });

    async function subject(): Promise<any> {
      return governanceModule.connect(subjectCaller.wallet).register(
        subjectCKToken,
        subjectIntegration,
      );
    }

    it("should register the CKToken for voting", async () => {
      await subject();

      const delegatee = await governanceAdapterMock.delegatee();
      expect(delegatee).to.eq(subjectCKToken);
    });

    it("emits the correct RegistrationSubmitted event", async () => {
      await expect(subject()).to.emit(governanceModule, "RegistrationSubmitted").withArgs(
        subjectCKToken,
        governanceAdapterMock.address
      );
    });

    describe("when the governance integration is not present", async () => {
      beforeEach(async () => {
        subjectIntegration = await getRandomAddress();
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Must be valid adapter");
      });
    });

    describe("when caller is not manager", async () => {
      beforeEach(async () => {
        subjectCaller = await getRandomAccount();
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Must be the CKToken manager");
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
          [governanceModule.address]
        );

        subjectCKToken = nonEnabledCKToken.address;
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Must be a valid and initialized CKToken");
      });
    });
  });

  describe("#revoke", async () => {
    let ckToken: CKToken;
    let isInitialized: boolean;

    let subjectCaller: Account;
    let subjectIntegration: string;
    let subjectCKToken: Address;

    before(async () => {
      isInitialized = true;
    });

    beforeEach(async () => {
      ckToken = await setup.createCKToken(
        [setup.weth.address],
        [ether(1)],
        [governanceModule.address]
      );

      subjectCaller = owner;

      subjectCKToken = ckToken.address;
      subjectIntegration = governanceAdapterMockIntegrationName;

      if (isInitialized) {
        await governanceModule.initialize(ckToken.address);
      }
    });

    async function subject(): Promise<any> {
      return governanceModule.connect(subjectCaller.wallet).revoke(
        subjectCKToken,
        subjectIntegration,
      );
    }

    it("should revoke the CKToken for voting", async () => {
      await subject();

      const delegatee = await governanceAdapterMock.delegatee();
      expect(delegatee).to.eq(ADDRESS_ZERO);
    });

    it("emits the correct RegistrationRevoked event", async () => {
      await expect(subject()).to.emit(governanceModule, "RegistrationRevoked").withArgs(
        subjectCKToken,
        governanceAdapterMock.address
      );
    });

    describe("when the governance integration is not present", async () => {
      beforeEach(async () => {
        subjectIntegration = await getRandomAddress();
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Must be valid adapter");
      });
    });

    describe("when caller is not manager", async () => {
      beforeEach(async () => {
        subjectCaller = await getRandomAccount();
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Must be the CKToken manager");
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
          [governanceModule.address]
        );

        subjectCKToken = nonEnabledCKToken.address;
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Must be a valid and initialized CKToken");
      });
    });
  });
});
