/*
    Copyright 2021 Cook Finance.

    Licensed under the Apache License, Version 2.0 (the "License");
    you may not use this file except in compliance with the License.
    You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

    Unless required by applicable law or agreed to in writing, software
    distributed under the License is distributed on an "AS IS" BASIS,
    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
    See the License for the specific language governing permissions and
    limitations under the License.

    SPDX-License-Identifier: Apache License, Version 2.0
*/

pragma solidity 0.6.10;
pragma experimental "ABIEncoderV2";

import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import { IController } from "../../interfaces/IController.sol";
import { IGovernanceAdapter } from "../../interfaces/IGovernanceAdapter.sol";
import { Invoke } from "../lib/Invoke.sol";
import { ICKToken } from "../../interfaces/ICKToken.sol";
import { ModuleBase } from "../lib/ModuleBase.sol";


/**
 * @title GovernanceModule
 * @author Cook Finance
 *
 * A smart contract module that enables participating in governance of component tokens held in the CKToken.
 * Examples of intended protocols include Compound, Uniswap, and Maker governance. 
 */
contract GovernanceModule is ModuleBase, ReentrancyGuard {
    using Invoke for ICKToken;

    /* ============ Events ============ */
    event ProposalVoted(
        ICKToken indexed _ckToken,
        IGovernanceAdapter indexed _governanceAdapter,
        uint256 indexed _proposalId,
        bool _support
    );

    event VoteDelegated(
        ICKToken indexed _ckToken,
        IGovernanceAdapter indexed _governanceAdapter,
        address _delegatee
    );

    event ProposalCreated(
        ICKToken indexed _ckToken,
        IGovernanceAdapter indexed _governanceAdapter,
        bytes _proposalData
    );

    event RegistrationSubmitted(
        ICKToken indexed _ckToken,
        IGovernanceAdapter indexed _governanceAdapter
    );

    event RegistrationRevoked(
        ICKToken indexed _ckToken,
        IGovernanceAdapter indexed _governanceAdapter
    );

    /* ============ Constructor ============ */

    constructor(IController _controller) public ModuleBase(_controller) {}

    /* ============ External Functions ============ */

    /**
     * CK MANAGER ONLY. Delegate voting power to an Ethereum address. Note: for some governance adapters, delegating to self is
     * equivalent to registering and delegating to zero address is revoking right to vote.
     *
     * @param _ckToken                 Address of CKToken
     * @param _governanceName           Human readable name of integration (e.g. COMPOUND) stored in the IntegrationRegistry
     * @param _delegatee                Address of delegatee
     */
    function delegate(
        ICKToken _ckToken,
        string memory _governanceName,
        address _delegatee
    )
        external
        nonReentrant
        onlyManagerAndValidCK(_ckToken)
    {
        IGovernanceAdapter governanceAdapter = IGovernanceAdapter(getAndValidateAdapter(_governanceName));

        (
            address targetExchange,
            uint256 callValue,
            bytes memory methodData
        ) = governanceAdapter.getDelegateCalldata(_delegatee);

        _ckToken.invoke(targetExchange, callValue, methodData);

        emit VoteDelegated(_ckToken, governanceAdapter, _delegatee);
    }

    /**
     * CK MANAGER ONLY. Create a new proposal for a specified governance protocol.
     *
     * @param _ckToken                 Address of CKToken
     * @param _governanceName           Human readable name of integration (e.g. COMPOUND) stored in the IntegrationRegistry
     * @param _proposalData             Byte data of proposal to pass into governance adapter
     */
    function propose(
        ICKToken _ckToken,
        string memory _governanceName,
        bytes memory _proposalData
    )
        external
        nonReentrant
        onlyManagerAndValidCK(_ckToken)
    {
        IGovernanceAdapter governanceAdapter = IGovernanceAdapter(getAndValidateAdapter(_governanceName));

        (
            address targetExchange,
            uint256 callValue,
            bytes memory methodData
        ) = governanceAdapter.getProposeCalldata(_proposalData);

        _ckToken.invoke(targetExchange, callValue, methodData);

        emit ProposalCreated(_ckToken, governanceAdapter, _proposalData);
    }

    /**
     * CK MANAGER ONLY. Register for voting for the CKToken
     *
     * @param _ckToken                 Address of CKToken
     * @param _governanceName           Human readable name of integration (e.g. COMPOUND) stored in the IntegrationRegistry
     */
    function register(
        ICKToken _ckToken,
        string memory _governanceName
    )
        external
        nonReentrant
        onlyManagerAndValidCK(_ckToken)
    {
        IGovernanceAdapter governanceAdapter = IGovernanceAdapter(getAndValidateAdapter(_governanceName));

        (
            address targetExchange,
            uint256 callValue,
            bytes memory methodData
        ) = governanceAdapter.getRegisterCalldata(address(_ckToken));

        _ckToken.invoke(targetExchange, callValue, methodData);

        emit RegistrationSubmitted(_ckToken, governanceAdapter);
    }

    /**
     * CK MANAGER ONLY. Revoke voting for the CKToken
     *
     * @param _ckToken                 Address of CKToken
     * @param _governanceName           Human readable name of integration (e.g. COMPOUND) stored in the IntegrationRegistry
     */
    function revoke(
        ICKToken _ckToken,
        string memory _governanceName
    )
        external
        nonReentrant
        onlyManagerAndValidCK(_ckToken)
    {
        IGovernanceAdapter governanceAdapter = IGovernanceAdapter(getAndValidateAdapter(_governanceName));

        (
            address targetExchange,
            uint256 callValue,
            bytes memory methodData
        ) = governanceAdapter.getRevokeCalldata();

        _ckToken.invoke(targetExchange, callValue, methodData);

        emit RegistrationRevoked(_ckToken, governanceAdapter);
    }

    /**
     * CK MANAGER ONLY. Cast vote for a specific governance token held in the CKToken. Manager specifies whether to vote for or against
     * a given proposal
     *
     * @param _ckToken                 Address of CKToken
     * @param _governanceName           Human readable name of integration (e.g. COMPOUND) stored in the IntegrationRegistry
     * @param _proposalId               ID of the proposal to vote on
     * @param _support                  Boolean indicating whether to support proposal
     * @param _data                     Arbitrary bytes to be used to construct vote call data
     */
    function vote(
        ICKToken _ckToken,
        string memory _governanceName,
        uint256 _proposalId,
        bool _support,
        bytes memory _data
    )
        external
        nonReentrant
        onlyManagerAndValidCK(_ckToken)
    {
        IGovernanceAdapter governanceAdapter = IGovernanceAdapter(getAndValidateAdapter(_governanceName));

        (
            address targetExchange,
            uint256 callValue,
            bytes memory methodData
        ) = governanceAdapter.getVoteCalldata(
            _proposalId,
            _support,
            _data
        );

        _ckToken.invoke(targetExchange, callValue, methodData);

        emit ProposalVoted(_ckToken, governanceAdapter, _proposalId, _support);
    }

    /**
     * Initializes this module to the CKToken. Only callable by the CKToken's manager.
     *
     * @param _ckToken             Instance of the CKToken to issue
     */
    function initialize(ICKToken _ckToken) external onlyCKManager(_ckToken, msg.sender) onlyValidAndPendingCK(_ckToken) {
        _ckToken.initializeModule();
    }

    /**
     * Removes this module from the CKToken, via call by the CKToken.
     */
    function removeModule() external override {}
}