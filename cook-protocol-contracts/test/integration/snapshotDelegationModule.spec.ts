import "module-alias/register";

import { ContractTransaction, Address } from "@utils/types";
import { Account } from "@utils/test/types";
import { CKToken, DelegateRegistry, GovernanceModule, SnapshotGovernanceAdapter } from "@utils/contracts";
import { ADDRESS_ZERO, ZERO_BYTES } from "@utils/constants";
import DeployHelper from "@utils/deploys";
import { ether } from "@utils/index";
import {
  addSnapshotBeforeRestoreAfterEach,
  getAccounts,
  getRandomAddress,
  getWaffleExpect,
  getSystemFixture,
} from "@utils/test/index";
import { SystemFixture } from "@utils/fixtures";

const expect = getWaffleExpect();

describe("SnapshotDelegationModule", () => {
  let owner: Account;
  let deployer: DeployHelper;
  let setup: SystemFixture;

  const snapshotGovernanceAdapterIntegrationName: string = "SNAPSHOT";

  let ckToken: CKToken;
  let governanceModule: GovernanceModule;
  let snapshotGovernanceAdapter: SnapshotGovernanceAdapter;
  let delegateRegistry: DelegateRegistry;

  before(async () => {
    [ owner ] = await getAccounts();

    deployer = new DeployHelper(owner.wallet);
    setup = getSystemFixture(owner.address);
    await setup.initialize();
  });

  beforeEach(async () => {
    delegateRegistry = await deployer.external.deployDelegateRegistry();
    snapshotGovernanceAdapter = await deployer.adapters.deploySnapshotGovernanceAdapter(delegateRegistry.address);

    governanceModule = await deployer.modules.deployGovernanceModule(setup.controller.address);
    await setup.controller.addModule(governanceModule.address);

    await setup.integrationRegistry.addIntegration(
      governanceModule.address,
      snapshotGovernanceAdapterIntegrationName,
      snapshotGovernanceAdapter.address
    );

    ckToken = await setup.createCKToken(
      [setup.weth.address],
      [ether(1)],
      [governanceModule.address],
      owner.address
    );

    await governanceModule.connect(owner.wallet).initialize(ckToken.address);
  });

  addSnapshotBeforeRestoreAfterEach();

  describe("#delegate", async () => {
    let subjectCKToken: CKToken;
    let subjectCaller: Account;
    let subjectDelegate: Address;

    beforeEach(async () => {
      subjectCaller = owner;
      subjectDelegate = await getRandomAddress();
      subjectCKToken = ckToken;
    });

    async function subject(): Promise<ContractTransaction> {
      return governanceModule.connect(subjectCaller.wallet).delegate(
        subjectCKToken.address,
        snapshotGovernanceAdapterIntegrationName,
        subjectDelegate
      );
    }

    it("should update delegation", async () => {
      await subject();
      const delegate = await delegateRegistry.delegation(subjectCKToken.address, ZERO_BYTES);
      expect(delegate).to.eq(subjectDelegate);
    });

    it("should emit a VoteDelegated event", async () => {
      await expect(subject()).to.emit(governanceModule, "VoteDelegated").withArgs(
        subjectCKToken.address,
        snapshotGovernanceAdapter.address,
        subjectDelegate
      );
    });
  });

  describe("#revoke", async () => {
    let subjectCKToken: CKToken;
    let subjectCaller: Account;

    beforeEach(async () => {
      subjectCaller = owner;
      subjectCKToken = ckToken;

      // add a delegate to be revoked
      await governanceModule.connect(subjectCaller.wallet).delegate(
        subjectCKToken.address,
        snapshotGovernanceAdapterIntegrationName,
        await getRandomAddress()
      );
    });

    async function subject(): Promise<ContractTransaction> {
      return governanceModule.connect(subjectCaller.wallet).revoke(
        subjectCKToken.address,
        snapshotGovernanceAdapterIntegrationName,
      );
    }

    it("should update delegation to zero address", async () => {
      await subject();
      const delegate = await delegateRegistry.delegation(subjectCKToken.address, ZERO_BYTES);
      expect(delegate).to.eq(ADDRESS_ZERO);
    });

    it("should emit a RegistrationRevoked event", async () => {
      await expect(subject()).to.emit(governanceModule, "RegistrationRevoked").withArgs(
        subjectCKToken.address,
        snapshotGovernanceAdapter.address
      );
    });
  });
});
