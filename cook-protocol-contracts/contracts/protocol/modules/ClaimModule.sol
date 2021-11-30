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

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { AddressArrayUtils } from "../../lib/AddressArrayUtils.sol";
import { IClaimAdapter } from "../../interfaces/IClaimAdapter.sol";
import { IController } from "../../interfaces/IController.sol";
import { ICKToken } from "../../interfaces/ICKToken.sol";
import { ModuleBase } from "../lib/ModuleBase.sol";


/**
 * @title ClaimModule
 * @author Cook Finance
 *
 * Module that enables managers to claim tokens from external protocols given to the CK as part of participating in
 * incentivized activities of other protocols. The ClaimModule works in conjunction with ClaimAdapters, in which the 
 * claimAdapterID / integrationNames are stored on the integration registry.
 * 
 * Design:
 * The ecosystem is coalescing around a few standards of how reward programs are created, using forks of popular
 * contracts such as Synthetix's Mintr. Thus, the Claim architecture reflects a more functional vs external-protocol
 * approach where an adapter with common functionality can be used across protocols. 
 *
 * Definitions:
 * Reward Pool: A reward pool is a contract associated with an external protocol's reward. Examples of reward pools
 *   include the Curve sUSDV2 Gauge or the Synthetix iBTC StakingReward contract.
 * Adapter: An adapter contains the logic and context for how a reward pool should be claimed - returning the requisite
 *   function signature. Examples of adapters include StakingRewardAdapter (for getting rewards from Synthetix-like
 *   reward contracts) and CurveClaimAdapter (for calling Curve Minter contract's mint function)
 * ClaimSettings: A reward pool can be associated with multiple awards. For example, a Curve liquidity gauge can be
 *   associated with the CURVE_CLAIM adapter to claim CRV and CURVE_DIRECT adapter to claim BPT.
 */
contract ClaimModule is ModuleBase {
    using AddressArrayUtils for address[];

    /* ============ Events ============ */

    event RewardClaimed(
        ICKToken indexed _ckToken,
        address indexed _rewardPool,
        IClaimAdapter indexed _adapter,
        uint256 _amount
    );

    event AnyoneClaimUpdated(
        ICKToken indexed _ckToken,
        bool _anyoneClaim
    );

    /* ============ Modifiers ============ */

    /**
     * Throws if claim is confined to the manager and caller is not the manager
     */
    modifier onlyValidCaller(ICKToken _ckToken) {
        require(_isValidCaller(_ckToken), "Must be valid caller");
        _;
    }

    /* ============ State Variables ============ */

    // Indicates if any address can call claim or just the manager of the CKToken
    mapping(ICKToken => bool) public anyoneClaim;

    // Map and array of rewardPool addresses to claim rewards for the CKToken
    mapping(ICKToken => address[]) public rewardPoolList;
    // Map from CK tokens to rewards pool address to isAdded boolean. Used to check if a reward pool has been added in O(1) time
    mapping(ICKToken => mapping(address => bool)) public rewardPoolStatus;

    // Map and array of adapters associated to the rewardPool for the CKToken
    mapping(ICKToken => mapping(address => address[])) public claimSettings;
    // Map from CK tokens to rewards pool address to claim adapters to isAdded boolean. Used to check if an adapter has been added in O(1) time
    mapping(ICKToken => mapping(address => mapping(address => bool))) public claimSettingsStatus;

    /* ============ Constructor ============ */

    constructor(IController _controller) public ModuleBase(_controller) {}

    /* ============ External Functions ============ */

    /**
     * Claim the rewards available on the rewardPool for the specified claim integration.
     * Callable only by manager unless manager has set anyoneClaim to true.
     *
     * @param _ckToken              Address of CKToken
     * @param _rewardPool           Address of the rewardPool that identifies the contract governing claims
     * @param _integrationName      ID of claim module integration (mapping on integration registry)
     */
    function claim(
        ICKToken _ckToken,
        address _rewardPool,
        string calldata _integrationName
    )
        external
        onlyValidAndInitializedCK(_ckToken)
        onlyValidCaller(_ckToken)
    {
        _claim(_ckToken, _rewardPool, _integrationName);
    }

    /**
     * Claims rewards on all the passed rewardPool/claim integration pairs. Callable only by manager unless manager has
     * set anyoneClaim to true.
     *
     * @param _ckToken              Address of CKToken
     * @param _rewardPools          Addresses of rewardPools that identifies the contract governing claims. Maps to same
     *                                  index integrationNames
     * @param _integrationNames     Human-readable names matching adapter used to collect claim on pool. Maps to same index
     *                                  in rewardPools
     */
    function batchClaim(
        ICKToken _ckToken,
        address[] calldata _rewardPools,
        string[] calldata _integrationNames
    )
        external
        onlyValidAndInitializedCK(_ckToken)
        onlyValidCaller(_ckToken)
    {
        uint256 poolArrayLength = _validateBatchArrays(_rewardPools, _integrationNames);
        for (uint256 i = 0; i < poolArrayLength; i++) {
            _claim(_ckToken, _rewardPools[i], _integrationNames[i]);
        }
    }

    /**
     * CK MANAGER ONLY. Update whether manager allows other addresses to call claim.
     *
     * @param _ckToken             Address of CKToken
     */
    function updateAnyoneClaim(ICKToken _ckToken, bool _anyoneClaim) external onlyManagerAndValidCK(_ckToken) {
        anyoneClaim[_ckToken] = _anyoneClaim;
        emit AnyoneClaimUpdated(_ckToken, _anyoneClaim);
    }

    /**
     * CK MANAGER ONLY. Adds a new claim integration for an existent rewardPool. If rewardPool doesn't have existing
     * claims then rewardPool is added to rewardPoolLiost. The claim integration is associated to an adapter that
     * provides the functionality to claim the rewards for a specific token.
     *
     * @param _ckToken              Address of CKToken
     * @param _rewardPool           Address of the rewardPool that identifies the contract governing claims
     * @param _integrationName      ID of claim module integration (mapping on integration registry)
     */
    function addClaim(
        ICKToken _ckToken,
        address _rewardPool,
        string calldata _integrationName
    )
        external
        onlyManagerAndValidCK(_ckToken)
    {
        _addClaim(_ckToken, _rewardPool, _integrationName);
    }

    /**
     * CK MANAGER ONLY. Adds a new rewardPool to the list to perform claims for the CKToken indicating the list of
     * claim integrations. Each claim integration is associated to an adapter that provides the functionality to claim
     * the rewards for a specific token.
     *
     * @param _ckToken              Address of CKToken
     * @param _rewardPools          Addresses of rewardPools that identifies the contract governing claims. Maps to same
     *                                  index integrationNames
     * @param _integrationNames     Human-readable names matching adapter used to collect claim on pool. Maps to same index
     *                                  in rewardPools
     */
    function batchAddClaim(
        ICKToken _ckToken,
        address[] calldata _rewardPools,
        string[] calldata _integrationNames
    )
        external
        onlyManagerAndValidCK(_ckToken)
    {
        _batchAddClaim(_ckToken, _rewardPools, _integrationNames);
    }

    /**
     * CK MANAGER ONLY. Removes a claim integration from an existent rewardPool. If no claim remains for reward pool then
     * reward pool is removed from rewardPoolList.
     *
     * @param _ckToken              Address of CKToken
     * @param _rewardPool           Address of the rewardPool that identifies the contract governing claims
     * @param _integrationName      ID of claim module integration (mapping on integration registry)
     */
    function removeClaim(
        ICKToken _ckToken,
        address _rewardPool,
        string calldata _integrationName
    )
        external
        onlyManagerAndValidCK(_ckToken)
    {
        _removeClaim(_ckToken, _rewardPool, _integrationName);
    }

    /**
     * CK MANAGER ONLY. Batch removes claims from CKToken's settings.
     *
     * @param _ckToken              Address of CKToken
     * @param _rewardPools          Addresses of rewardPools that identifies the contract governing claims. Maps to same index
     *                                  integrationNames
     * @param _integrationNames     Human-readable names matching adapter used to collect claim on pool. Maps to same index in
     *                                  rewardPools
     */
    function batchRemoveClaim(
        ICKToken _ckToken,
        address[] calldata _rewardPools,
        string[] calldata _integrationNames
    )
        external
        onlyManagerAndValidCK(_ckToken)
    {
        uint256 poolArrayLength = _validateBatchArrays(_rewardPools, _integrationNames);
        for (uint256 i = 0; i < poolArrayLength; i++) {
            _removeClaim(_ckToken, _rewardPools[i], _integrationNames[i]);
        }
    }
 
    /**
     * CK MANAGER ONLY. Initializes this module to the CKToken.
     *
     * @param _ckToken              Instance of the CKToken to issue
     * @param _anyoneClaim          Boolean indicating if anyone can claim or just manager
     * @param _rewardPools          Addresses of rewardPools that identifies the contract governing claims. Maps to same index
     *                                  integrationNames
     * @param _integrationNames     Human-readable names matching adapter used to collect claim on pool. Maps to same index in
     *                                  rewardPools
     */
    function initialize(
        ICKToken _ckToken,
        bool _anyoneClaim,
        address[] calldata _rewardPools,
        string[] calldata _integrationNames
    )
        external
        onlyCKManager(_ckToken, msg.sender)
        onlyValidAndPendingCK(_ckToken)
    {
        _batchAddClaim(_ckToken, _rewardPools, _integrationNames);
        anyoneClaim[_ckToken] = _anyoneClaim;
        _ckToken.initializeModule();
    }

    /**
     * Removes this module from the CKToken, via call by the CKToken.
     */
    function removeModule() external override {
        delete anyoneClaim[ICKToken(msg.sender)];

        // explicitly delete all elements for gas refund
        address[] memory ckTokenPoolList = rewardPoolList[ICKToken(msg.sender)];
        for (uint256 i = 0; i < ckTokenPoolList.length; i++) {

            address[] storage adapterList = claimSettings[ICKToken(msg.sender)][ckTokenPoolList[i]];
            for (uint256 j = 0; j < adapterList.length; j++) {

                address toRemove = adapterList[j];
                claimSettingsStatus[ICKToken(msg.sender)][ckTokenPoolList[i]][toRemove] = false;

                delete adapterList[j];
            }
            delete claimSettings[ICKToken(msg.sender)][ckTokenPoolList[i]];
        }

        for (uint256 i = 0; i < rewardPoolList[ICKToken(msg.sender)].length; i++) {
            address toRemove = rewardPoolList[ICKToken(msg.sender)][i];
            rewardPoolStatus[ICKToken(msg.sender)][toRemove] = false;

            delete rewardPoolList[ICKToken(msg.sender)][i];
        }
        delete rewardPoolList[ICKToken(msg.sender)];
    }

    /**
     * Get list of rewardPools to perform claims for the CKToken.
     *
     * @param _ckToken              Address of CKToken
     * @return                      Array of rewardPool addresses to claim rewards for the CKToken
     */
    function getRewardPools(ICKToken _ckToken) external view returns (address[] memory) {
        return rewardPoolList[_ckToken];
    }

    /**
     * Get boolean indicating if the rewardPool is in the list to perform claims for the CKToken.
     *
     * @param _ckToken              Address of CKToken
     * @param _rewardPool           Address of rewardPool
     * @return                      Boolean indicating if the rewardPool is in the list for claims.
     */
    function isRewardPool(ICKToken _ckToken, address _rewardPool) public view returns (bool) {
        return rewardPoolStatus[_ckToken][_rewardPool];
    }

    /**
     * Get list of claim integration of the rewardPool for the CKToken.
     *
     * @param _ckToken              Address of CKToken
     * @param _rewardPool           Address of rewardPool
     * @return                      Array of adapter addresses associated to the rewardPool for the CKToken
     */
    function getRewardPoolClaims(ICKToken _ckToken, address _rewardPool) external view returns (address[] memory) {
        return claimSettings[_ckToken][_rewardPool];
    }

    /**
     * Get boolean indicating if the adapter address of the claim integration is associated to the rewardPool.
     *
     * @param _ckToken              Address of CKToken
     * @param _rewardPool           Address of rewardPool
     * @param _integrationName      ID of claim module integration (mapping on integration registry)
     * @return                      Boolean indicating if the claim integration is associated to the rewardPool.
     */
    function isRewardPoolClaim(
        ICKToken _ckToken,
        address _rewardPool,
        string calldata _integrationName
    )
        external
        view
        returns (bool)
    {
        address adapter = getAndValidateAdapter(_integrationName);
        return claimSettingsStatus[_ckToken][_rewardPool][adapter];
    }

    /**
     * Get the rewards available to be claimed by the claim integration on the rewardPool.
     *
     * @param _ckToken              Address of CKToken
     * @param _rewardPool           Address of the rewardPool that identifies the contract governing claims
     * @param _integrationName      ID of claim module integration (mapping on integration registry)
     * @return rewards              Amount of units available to be claimed
     */
    function getRewards(
        ICKToken _ckToken,
        address _rewardPool,
        string calldata _integrationName
    )
        external
        view
        returns (uint256)
    {
        IClaimAdapter adapter = _getAndValidateIntegrationAdapter(_ckToken, _rewardPool, _integrationName);
        return adapter.getRewardsAmount(_ckToken, _rewardPool);
    }

    /* ============ Internal Functions ============ */

    /**
     * Claim the rewards, if available, on the rewardPool using the specified adapter. Interact with the adapter to get
     * the rewards available, the calldata for the CKToken to invoke the claim and the token associated to the claim.
     *
     * @param _ckToken              Address of CKToken
     * @param _rewardPool           Address of the rewardPool that identifies the contract governing claims
     * @param _integrationName      Human readable name of claim integration
     */
    function _claim(ICKToken _ckToken, address _rewardPool, string calldata _integrationName) internal {
        require(isRewardPool(_ckToken, _rewardPool), "RewardPool not present");
        IClaimAdapter adapter = _getAndValidateIntegrationAdapter(_ckToken, _rewardPool, _integrationName);

        IERC20 rewardsToken = IERC20(adapter.getTokenAddress(_rewardPool));
        uint256 initRewardsBalance = rewardsToken.balanceOf(address(_ckToken));

        (
            address callTarget,
            uint256 callValue,
            bytes memory callByteData
        ) = adapter.getClaimCallData(
            _ckToken,
            _rewardPool
        );

        _ckToken.invoke(callTarget, callValue, callByteData);

        uint256 finalRewardsBalance = rewardsToken.balanceOf(address(_ckToken));

        emit RewardClaimed(_ckToken, _rewardPool, adapter, finalRewardsBalance.sub(initRewardsBalance));
    }

    /**
     * Gets the adapter and validate it is associated to the list of claim integration of a rewardPool.
     *
     * @param _ckToken              Address of CKToken
     * @param _rewardsPool          Address of rewards pool
     * @param _integrationName      ID of claim module integration (mapping on integration registry)
     */
    function _getAndValidateIntegrationAdapter(
        ICKToken _ckToken,
        address _rewardsPool,
        string calldata _integrationName
    )
        internal
        view
        returns (IClaimAdapter)
    {
        address adapter = getAndValidateAdapter(_integrationName);
        require(claimSettingsStatus[_ckToken][_rewardsPool][adapter], "Adapter integration not present");
        return IClaimAdapter(adapter);
    }

    /**
     * Validates and store the adapter address used to claim rewards for the passed rewardPool. If after adding
     * adapter to pool length of adapters is 1 then add to rewardPoolList as well.
     *
     * @param _ckToken                  Address of CKToken
     * @param _rewardPool               Address of the rewardPool that identifies the contract governing claims
     * @param _integrationName          ID of claim module integration (mapping on integration registry)
     */
    function _addClaim(ICKToken _ckToken, address _rewardPool, string calldata _integrationName) internal {
        address adapter = getAndValidateAdapter(_integrationName);
        address[] storage _rewardPoolClaimSettings = claimSettings[_ckToken][_rewardPool];

        require(!claimSettingsStatus[_ckToken][_rewardPool][adapter], "Integration names must be unique");
        _rewardPoolClaimSettings.push(adapter);
        claimSettingsStatus[_ckToken][_rewardPool][adapter] = true;

        if (!rewardPoolStatus[_ckToken][_rewardPool]) {
            rewardPoolList[_ckToken].push(_rewardPool);
            rewardPoolStatus[_ckToken][_rewardPool] = true;
        }
    }

    /**
     * Internal version. Adds a new rewardPool to the list to perform claims for the CKToken indicating the list of claim 
     * integrations. Each claim integration is associated to an adapter that provides the functionality to claim the rewards
     * for a specific token.
     *
     * @param _ckToken              Address of CKToken
     * @param _rewardPools          Addresses of rewardPools that identifies the contract governing claims. Maps to same
     *                                  index integrationNames
     * @param _integrationNames     Human-readable names matching adapter used to collect claim on pool. Maps to same index
     *                                  in rewardPools
     */
    function _batchAddClaim(
        ICKToken _ckToken,
        address[] calldata _rewardPools,
        string[] calldata _integrationNames
    )
        internal
    {
        uint256 poolArrayLength = _validateBatchArrays(_rewardPools, _integrationNames);
        for (uint256 i = 0; i < poolArrayLength; i++) {
            _addClaim(_ckToken, _rewardPools[i], _integrationNames[i]);
        }
    }

    /**
     * Validates and stores the adapter address used to claim rewards for the passed rewardPool. If no adapters
     * left after removal then remove rewardPool from rewardPoolList and delete entry in claimSettings.
     *
     * @param _ckToken                  Address of CKToken
     * @param _rewardPool               Address of the rewardPool that identifies the contract governing claims
     * @param _integrationName          ID of claim module integration (mapping on integration registry)
     */
    function _removeClaim(ICKToken _ckToken, address _rewardPool, string calldata _integrationName) internal {
        address adapter = getAndValidateAdapter(_integrationName);

        require(claimSettingsStatus[_ckToken][_rewardPool][adapter], "Integration must be added");
        claimSettings[_ckToken][_rewardPool].removeStorage(adapter);
        claimSettingsStatus[_ckToken][_rewardPool][adapter] = false;

        if (claimSettings[_ckToken][_rewardPool].length == 0) {
            rewardPoolList[_ckToken].removeStorage(_rewardPool);
            rewardPoolStatus[_ckToken][_rewardPool] = false;
        }
    }

    /**
     * For batch functions validate arrays are of equal length and not empty. Return length of array for iteration.
     *
     * @param _rewardPools              Addresses of the rewardPool that identifies the contract governing claims
     * @param _integrationNames         IDs of claim module integration (mapping on integration registry)
     * @return                          Length of arrays
     */
    function _validateBatchArrays(
        address[] memory _rewardPools,
        string[] calldata _integrationNames
    )
        internal
        pure
        returns(uint256)
    {
        uint256 poolArrayLength = _rewardPools.length;
        require(poolArrayLength == _integrationNames.length, "Array length mismatch");
        require(poolArrayLength > 0, "Arrays must not be empty");
        return poolArrayLength;
    }

    /**
     * If claim is confined to the manager, manager must be caller
     *
     * @param _ckToken              Address of CKToken
     * @return bool                 Whether or not the caller is valid
     */
    function _isValidCaller(ICKToken _ckToken) internal view returns(bool) {
        return anyoneClaim[_ckToken] || isCKManager(_ckToken, msg.sender);
    }
}