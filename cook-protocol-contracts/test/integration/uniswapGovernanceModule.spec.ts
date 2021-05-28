import "module-alias/register";
import { BigNumber } from "@ethersproject/bignumber";
import { defaultAbiCoder } from "ethers/lib/utils";

import { Address, Bytes } from "@utils/types";
import { Account } from "@utils/test/types";
import { ADDRESS_ZERO, EMPTY_BYTES, ONE, ONE_DAY_IN_SECONDS, ZERO } from "@utils/constants";
import { CompoundLikeGovernanceAdapter, CKToken, GovernanceModule } from "@utils/contracts";
import DeployHelper from "@utils/deploys";
import {
  ether,
} from "@utils/index";
import {
  getAccounts,
  getWaffleExpect,
  getSystemFixture,
  getUniswapFixture,
  getRandomAddress,
  increaseTimeAsync,
  addSnapshotBeforeRestoreAfterEach,
} from "@utils/test/index";
import { UniswapFixture, SystemFixture } from "@utils/fixtures";

const expect = getWaffleExpect();

describe("UniswapGovernanceModule", () => {
  let owner: Account;
  let deployer: DeployHelper;
  let setup: SystemFixture;

  let uniswapSetup: UniswapFixture;

  let governanceModule: GovernanceModule;
  let compoundLikeGovernanceAdapter: CompoundLikeGovernanceAdapter;

  const compoundLikeGovernanceAdapterIntegrationName: string = "UNISWAP";

  before(async () => {
    [
      owner,
    ] = await getAccounts();

    // System setup
    deployer = new DeployHelper(owner.wallet);
    setup = getSystemFixture(owner.address);
    await setup.initialize();

    // Uniswap setup
    uniswapSetup = getUniswapFixture(owner.address);
    await uniswapSetup.initialize(owner, setup.weth.address, setup.wbtc.address, setup.dai.address);

    // GovernanceModule setup
    governanceModule = await deployer.modules.deployGovernanceModule(setup.controller.address);
    await setup.controller.addModule(governanceModule.address);

    // CompoundLikeGovernanceAdapter setup
    compoundLikeGovernanceAdapter = await deployer.adapters.deployCompoundLikeGovernanceAdapter(
      uniswapSetup.uniswapGovernorAlpha.address,
      uniswapSetup.uni.address,
    );

    await setup.integrationRegistry.addIntegration(
      governanceModule.address,
      compoundLikeGovernanceAdapterIntegrationName,
      compoundLikeGovernanceAdapter.address
    );
  });

  addSnapshotBeforeRestoreAfterEach();

  context("when a CKToken has been deployed and issued", async () => {
    let ckToken: CKToken;
    let ckTokensIssued: BigNumber;

    before(async () => {
      ckToken = await setup.createCKToken(
        [uniswapSetup.uni.address],
        [ether(20000000)], // 20m UNI
        [setup.issuanceModule.address, governanceModule.address]
      );

      // Initialize modules
      await setup.issuanceModule.initialize(ckToken.address, ADDRESS_ZERO);
      await governanceModule.initialize(ckToken.address);

      // Issue some CKs
      ckTokensIssued = ether(1);
      const underlyingRequired = ether(20000000);
      await uniswapSetup.uni.approve(setup.issuanceModule.address, underlyingRequired);
      await setup.issuanceModule.issue(ckToken.address, ckTokensIssued, owner.address);

      // Register for voting
      await governanceModule.register(ckToken.address, compoundLikeGovernanceAdapterIntegrationName);
    });

    describe("#propose", async () => {
      let targets: Address[];
      let values: BigNumber[];
      let signatures: string[];
      let calldatas: Bytes[];
      let description: string;

      let subjectCKToken: Address;
      let subjectProposalData: Bytes;
      let subjectIntegrationName: string;
      let subjectCaller: Account;

      beforeEach(async () => {
        targets = [await getRandomAddress(), await getRandomAddress()];
        values = [ZERO, ZERO];
        // Random functions from sample Compound governance proposal
        signatures = ["_supportMarket(address)", "_setReserveFactor(uint256)"];
        // Random bytes from sample Compound governance proposal
        calldatas = [
          "0x00000000000000000000000070e36f6bf80a52b3b46b3af8e106cc0ed743e8e4",
          "0x00000000000000000000000000000000000000000000000002c68af0bb140000",
        ];
        description = "Create A Proposal";

        subjectCKToken = ckToken.address;
        subjectIntegrationName = compoundLikeGovernanceAdapterIntegrationName;
        subjectProposalData = defaultAbiCoder.encode(
          ["address[]", "uint256[]", "string[]", "bytes[]", "string"],
          [targets, values, signatures, calldatas, description]
        );
        subjectCaller = owner;
      });

      async function subject(): Promise<any> {
        return governanceModule.connect(subjectCaller.wallet).propose(
          subjectCKToken,
          subjectIntegrationName,
          subjectProposalData
        );
      }

      it("should create a proposal in Uniswap", async () => {
        await subject();

        const proposalData = await uniswapSetup.uniswapGovernorAlpha.proposals(ONE);
        expect(proposalData.id).to.eq(ONE);
        expect(proposalData.proposer).to.eq(subjectCKToken);
      });
    });

    describe("#vote", async () => {
      let subjectCKToken: Address;
      let subjectProposalId: BigNumber;
      let subjectSupport: boolean;
      let subjectData: Bytes;
      let subjectIntegrationName: string;
      let subjectCaller: Account;

      beforeEach(async () => {
        const targets = [await getRandomAddress(), await getRandomAddress()];
        const values = [ZERO, ZERO];
        // Random functions from sample Compound governance proposal
        const signatures = ["_supportMarket(address)", "_setReserveFactor(uint256)"];
        // Random bytes from sample Compound governance proposal
        const calldatas = [
          "0x00000000000000000000000070e36f6bf80a52b3b46b3af8e106cc0ed743e8e4",
          "0x00000000000000000000000000000000000000000000000002c68af0bb140000",
        ];
        const description = "Create A Proposal";
        const proposalData = defaultAbiCoder.encode(
          ["address[]", "uint256[]", "string[]", "bytes[]", "string"],
          [targets, values, signatures, calldatas, description]
        );

        await governanceModule.propose(ckToken.address, compoundLikeGovernanceAdapterIntegrationName, proposalData);
        await increaseTimeAsync(ONE_DAY_IN_SECONDS);

        subjectCKToken = ckToken.address;
        subjectIntegrationName = compoundLikeGovernanceAdapterIntegrationName;
        subjectProposalId = ONE;
        subjectSupport = true;
        subjectData = EMPTY_BYTES;
        subjectCaller = owner;
      });

      async function subject(): Promise<any> {
        return governanceModule.connect(subjectCaller.wallet).vote(
          subjectCKToken,
          subjectIntegrationName,
          subjectProposalId,
          subjectSupport,
          subjectData
        );
      }

      it("should vote in Uniswap", async () => {
        await subject();

        const proposalData = await uniswapSetup.uniswapGovernorAlpha.proposals(ONE);
        expect(proposalData.forVotes).to.eq(ether(20000000));
        expect(proposalData.againstVotes).to.eq(ZERO);
      });
    });

    describe("#delegate", async () => {
      let subjectCKToken: Address;
      let subjectDelegatee: Address;
      let subjectIntegrationName: string;
      let subjectCaller: Account;

      beforeEach(async () => {
        subjectCKToken = ckToken.address;
        subjectIntegrationName = compoundLikeGovernanceAdapterIntegrationName;
        subjectDelegatee = await getRandomAddress();
        subjectCaller = owner;
      });

      async function subject(): Promise<any> {
        return governanceModule.connect(subjectCaller.wallet).delegate(
          subjectCKToken,
          subjectIntegrationName,
          subjectDelegatee
        );
      }

      it("should delegate to another ETH address", async () => {
        await subject();

        const delegatee = await uniswapSetup.uni.delegates(subjectCKToken);
        expect(delegatee).to.eq(subjectDelegatee);
      });
    });

    describe("#register", async () => {
      let subjectCKToken: Address;
      let subjectIntegrationName: string;
      let subjectCaller: Account;

      beforeEach(async () => {
        subjectCKToken = ckToken.address;
        subjectIntegrationName = compoundLikeGovernanceAdapterIntegrationName;
        subjectCaller = owner;
      });

      async function subject(): Promise<any> {
        return governanceModule.connect(subjectCaller.wallet).register(
          subjectCKToken,
          subjectIntegrationName,
        );
      }

      it("should register to vote", async () => {
        await subject();

        const delegatee = await uniswapSetup.uni.delegates(subjectCKToken);
        expect(delegatee).to.eq(subjectCKToken);
      });
    });

    describe("#revoke", async () => {
      let subjectCKToken: Address;
      let subjectIntegrationName: string;
      let subjectCaller: Account;

      beforeEach(async () => {
        subjectCKToken = ckToken.address;
        subjectIntegrationName = compoundLikeGovernanceAdapterIntegrationName;
        subjectCaller = owner;
      });

      async function subject(): Promise<any> {
        return governanceModule.connect(subjectCaller.wallet).revoke(
          subjectCKToken,
          subjectIntegrationName,
        );
      }

      it("should revoke right to vote", async () => {
        await subject();

        const delegatee = await uniswapSetup.uni.delegates(subjectCKToken);
        expect(delegatee).to.eq(ADDRESS_ZERO);
      });
    });
  });
});
