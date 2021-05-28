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
import { SafeCast } from "@openzeppelin/contracts/utils/SafeCast.sol";
import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";
import { SignedSafeMath } from "@openzeppelin/contracts/math/SignedSafeMath.sol";

import { AddressArrayUtils } from "../../lib/AddressArrayUtils.sol";
import { IController } from "../../interfaces/IController.sol";
import { IModuleIssuanceHook } from "../../interfaces/IModuleIssuanceHook.sol";
import { Invoke } from "../lib/Invoke.sol";
import { ICKToken } from "../../interfaces/ICKToken.sol";
import { IStakingAdapter } from "../../interfaces/IStakingAdapter.sol";
import { ModuleBase } from "../lib/ModuleBase.sol";
import { Position } from "../lib/Position.sol";


/**
 * @title StakingModule
 * @author Cook Finance
 *
 * Module that enables managers to stake tokens in external protocols in order to take advantage of token distributions.
 * Managers are in charge of opening and closing staking positions. When issuing new CKTokens the IssuanceModule can call
 * the StakingModule in order to facilitate replicating existing staking positions.
 *
 * The StakingModule works in conjunction with StakingAdapters, in which the claimAdapterID / integrationNames are stored
 * on the integration registry. StakingAdapters for the StakingModule are more functional in nature as the same staking
 * contracts are being used across multiple protocols.
 *
 * An example of staking actions include staking yCRV tokens in CRV Liquidity Gauge
 */
contract StakingModule is ModuleBase, IModuleIssuanceHook {
    using AddressArrayUtils for address[];
    using Invoke for ICKToken;
    using Position for ICKToken;
    using SafeCast for int256;
    using SignedSafeMath for int256;
    using SafeCast for uint256;
    using SafeMath for uint256;
    using Position for uint256;

    /* ============ Events ============ */

    event ComponentStaked(
        ICKToken indexed _ckToken,
        IERC20 indexed _component,
        address indexed _stakingContract,
        uint256 _componentPositionUnits,
        IStakingAdapter _adapter
    );

    event ComponentUnstaked(
        ICKToken indexed _ckToken,
        IERC20 indexed _component,
        address indexed _stakingContract,
        uint256 _componentPositionUnits,
        IStakingAdapter _adapter
    );

    /* ============ Structs ============ */

    struct StakingPosition {
        bytes32 adapterHash;                // Hash of adapter name
        uint256 componentPositionUnits;     // The amount of tokens, per CK, being staked on associated staking contract
    }

    struct ComponentPositions {
        address[] stakingContracts;                         // List of staking contracts component is being staked on
        mapping(address => StakingPosition) positions;      // Details of each stakingContract's position
    }

    /* ============ State Variables ============ */
    // Mapping relating CKToken to a component to a struct holding all the external staking positions for the component
    mapping(ICKToken => mapping(IERC20 => ComponentPositions)) internal stakingPositions;

    /* ============ Constructor ============ */

    constructor(IController _controller) public ModuleBase(_controller) {}

    /* ============ External Functions ============ */

    /**
     * MANAGER ONLY: Stake _component in external staking contract. Update state on StakingModule and CKToken to reflect
     * new position. Manager states the contract they are wishing to stake the passed component in as well as how many
     * position units they wish to stake. Manager must also identify the adapter they wish to use.
     *
     * @param _ckToken                 Address of CKToken contract
     * @param _stakeContract            Address of staking contract
     * @param _component                Address of token being staked
     * @param _adapterName              Name of adapter used to interact with staking contract
     * @param _componentPositionUnits   Quantity of token to stake in position units
     */
    function stake(
        ICKToken _ckToken,
        address _stakeContract,
        IERC20 _component,
        string memory _adapterName,
        uint256 _componentPositionUnits
    )
        external
        onlyManagerAndValidCK(_ckToken)
    {
        require(_ckToken.hasSufficientDefaultUnits(address(_component), _componentPositionUnits), "Not enough component to stake");

        IStakingAdapter adapter = IStakingAdapter(getAndValidateAdapter(_adapterName));

        _stake(_ckToken, _stakeContract, _component, adapter, _componentPositionUnits, _ckToken.totalSupply());

        _updateStakeState(_ckToken, _stakeContract, _component, _adapterName, _componentPositionUnits);

        emit ComponentStaked(
            _ckToken,
            _component,
            _stakeContract,
            _componentPositionUnits,
            adapter
        );
    }

    /**
     * MANAGER ONLY: Unstake _component from external staking contract. Update state on StakingModule and CKToken to reflect
     * new position.
     *
     * @param _ckToken                 Address of CKToken contract
     * @param _stakeContract            Address of staking contract
     * @param _component                Address of token being staked
     * @param _adapterName              Name of adapter used to interact with staking contract
     * @param _componentPositionUnits   Quantity of token to unstake in position units
     */
    function unstake(
        ICKToken _ckToken,
        address _stakeContract,
        IERC20 _component,
        string memory _adapterName,
        uint256 _componentPositionUnits
    )
        external
        onlyManagerAndValidCK(_ckToken)
    {
        require(
            getStakingPositionUnit(_ckToken, _component, _stakeContract) >= _componentPositionUnits,
            "Not enough component tokens staked"
        );

        IStakingAdapter adapter = IStakingAdapter(getAndValidateAdapter(_adapterName));

        _unstake(_ckToken, _stakeContract, _component, adapter, _componentPositionUnits, _ckToken.totalSupply());

        _updateUnstakeState(_ckToken, _stakeContract, _component, _componentPositionUnits);

        emit ComponentUnstaked(
            _ckToken,
            _component,
            _stakeContract,
            _componentPositionUnits,
            adapter
        );
    }

    /**
     * MODULE ONLY: On issuance, replicates all staking positions for a given component by staking the component transferred into
     * the CKToken by an issuer. The amount staked should only be the notional amount required to replicate a _ckTokenQuantity
     * amount of a position. No updates to positions should take place. 
     *
     * @param _ckToken                 Address of CKToken contract
     * @param _component                Address of token being staked
     * @param _ckTokenQuantity         Quantity of CKToken being issued
     */
    function componentIssueHook(ICKToken _ckToken, uint256 _ckTokenQuantity, IERC20 _component, bool /* _isEquity */) external override onlyModule(_ckToken) {
        address[] memory stakingContracts = getStakingContracts(_ckToken, _component);
        for (uint256 i = 0; i < stakingContracts.length; i++) {
            // NOTE: We assume here that the calling module has transferred component tokens to the CKToken from the issuer
            StakingPosition memory stakingPosition = getStakingPosition(_ckToken, _component, stakingContracts[i]);

            _stake(
                _ckToken,
                stakingContracts[i],
                _component,
                IStakingAdapter(getAndValidateAdapterWithHash(stakingPosition.adapterHash)),
                stakingPosition.componentPositionUnits,
                _ckTokenQuantity
            );
        }
    }

    /**
     * MODULE ONLY: On redemption, unwind all staking positions for a given asset by unstaking the given component. The amount
     * unstaked should only be the notional amount required to unwind a _ckTokenQuantity amount of a position. No updates to
     * positions should take place. 
     *
     * @param _ckToken                 Address of CKToken contract
     * @param _component                Address of token being staked
     * @param _ckTokenQuantity         Quantity of CKToken being issued
     */
    function componentRedeemHook(ICKToken _ckToken, uint256 _ckTokenQuantity, IERC20 _component, bool /* _isEquity */) external override onlyModule(_ckToken) {
        address[] memory stakingContracts = getStakingContracts(_ckToken, _component);
        for (uint256 i = 0; i < stakingContracts.length; i++) {
            StakingPosition memory stakingPosition = getStakingPosition(_ckToken, _component, stakingContracts[i]);

            _unstake(
                _ckToken,
                stakingContracts[i],
                _component,
                IStakingAdapter(getAndValidateAdapterWithHash(stakingPosition.adapterHash)),
                stakingPosition.componentPositionUnits,
                _ckTokenQuantity
            );
        }
    }

    function moduleIssueHook(ICKToken _ckToken, uint256 _ckTokenQuantity) external override {}
    function moduleRedeemHook(ICKToken _ckToken, uint256 _ckTokenQuantity) external override {}

    /**
     * Initializes this module to the CKToken. Only callable by the CKToken's manager.
     *
     * @param _ckToken             Instance of the CKToken to issue
     */
    function initialize(
        ICKToken _ckToken
    )
        external
        onlyCKManager(_ckToken, msg.sender)
        onlyValidAndPendingCK(_ckToken)
    {
        _ckToken.initializeModule();
    }

    /**
     * Removes this module from the CKToken, via call by the CKToken. If an outstanding staking position remains using
     * this module then it cannot be removed. Outstanding staking must be closed out first before removal.
     */
    function removeModule() external override {
        ICKToken ckToken = ICKToken(msg.sender);
        address[] memory components = ckToken.getComponents();
        for (uint256 i = 0; i < components.length; i++) {
            require(
                stakingPositions[ckToken][IERC20(components[i])].stakingContracts.length == 0,
                "Open positions must be closed"
            );
        }
    }


    /* ============ External Getter Functions ============ */

    function hasStakingPosition(ICKToken _ckToken, IERC20 _component, address _stakeContract) public view returns(bool) {
        return getStakingContracts(_ckToken, _component).contains(_stakeContract);
    }
    
    function getStakingContracts(ICKToken _ckToken, IERC20 _component) public view returns(address[] memory) {
        return stakingPositions[_ckToken][_component].stakingContracts;
    }

    function getStakingPosition(ICKToken _ckToken, IERC20 _component, address _stakeContract)
        public
        view
        returns(StakingPosition memory)
    {
        return stakingPositions[_ckToken][_component].positions[_stakeContract];
    }

    function getStakingPositionUnit(ICKToken _ckToken, IERC20 _component, address _stakeContract)
        public
        view
        returns(uint256)
    {
        return getStakingPosition(_ckToken, _component, _stakeContract).componentPositionUnits;
    }

    /* ============ Internal Functions ============ */

    /**
     * Stake _component in external staking contract.
     *
     * @param _ckToken                 Address of CKToken contract
     * @param _stakeContract            Address of staking contract
     * @param _component                Address of token being staked
     * @param _adapter                  Address of adapter used to interact with staking contract
     * @param _componentPositionUnits   Quantity of token to stake in position units
     * @param _ckTokenStakeQuantity    Quantity of CKTokens to stake
     */
    function _stake(
        ICKToken _ckToken,
        address _stakeContract,
        IERC20 _component,
        IStakingAdapter _adapter,
        uint256 _componentPositionUnits,
        uint256 _ckTokenStakeQuantity
    )
        internal
    {
        uint256 notionalStakeQuantity = _ckTokenStakeQuantity.getDefaultTotalNotional(_componentPositionUnits);

        address spender = _adapter.getSpenderAddress(_stakeContract);

        _ckToken.invokeApprove(address(_component), spender, notionalStakeQuantity);

        (
            address target, uint256 callValue, bytes memory methodData
        ) = _adapter.getStakeCallData(_stakeContract, notionalStakeQuantity);

        _ckToken.invoke(target, callValue, methodData);
    }

    /**
     * Unstake position from external staking contract and validates expected components were received.
     *
     * @param _ckToken                 Address of CKToken contract
     * @param _stakeContract            Address of staking contract
     * @param _component                Address of token being unstaked
     * @param _adapter                  Address of adapter used to interact with staking contract
     * @param _componentPositionUnits   Quantity of token to unstake in position units
     */
    function _unstake(
        ICKToken _ckToken,
        address _stakeContract,
        IERC20 _component,
        IStakingAdapter _adapter,
        uint256 _componentPositionUnits,
        uint256 _ckTokenUnstakeQuantity
    )
        internal
    {
        uint256 preActionBalance = _component.balanceOf(address(_ckToken));

        uint256 notionalUnstakeQuantity = _ckTokenUnstakeQuantity.getDefaultTotalNotional(_componentPositionUnits);
        (
            address target, uint256 callValue, bytes memory methodData
        ) = _adapter.getUnstakeCallData(_stakeContract, notionalUnstakeQuantity);

        _ckToken.invoke(target, callValue, methodData);

        uint256 postActionBalance = _component.balanceOf(address(_ckToken));
        require(preActionBalance.add(notionalUnstakeQuantity) <= postActionBalance, "Not enough tokens returned from stake contract");
    }

    /**
     * Update positions on CKToken and tracking on StakingModule after staking is complete. Includes the following updates:
     *  - If adding to position then add positionUnits to existing position amount on StakingModule
     *  - If opening new staking position add stakeContract to stakingContracts list and create position entry in position mapping
     *    (on StakingModule)
     *  - Subtract from Default position of _component on CKToken
     *  - Add to external position of _component on CKToken referencing this module
     *
     * @param _ckToken                 Address of CKToken contract
     * @param _stakeContract            Address of staking contract
     * @param _component                Address of token being unstaked
     * @param _adapterName              Address of adapter used to interact with staking contract
     * @param _componentPositionUnits   Quantity of token to stake in position units
     */
    function _updateStakeState(
        ICKToken _ckToken,
        address _stakeContract,
        IERC20 _component,
        string memory _adapterName,
        uint256 _componentPositionUnits
    )
        internal
    {
        if (hasStakingPosition(_ckToken, _component, _stakeContract)) {
            stakingPositions[_ckToken][_component].positions[_stakeContract].componentPositionUnits = _componentPositionUnits.add(
                getStakingPositionUnit(_ckToken, _component, _stakeContract)
            );
        } else {
            stakingPositions[_ckToken][_component].stakingContracts.push(_stakeContract);
            stakingPositions[_ckToken][_component].positions[_stakeContract] = StakingPosition({
                componentPositionUnits: _componentPositionUnits,
                adapterHash: getNameHash(_adapterName)
            });
        }

        uint256 newDefaultTokenUnit = _ckToken.getDefaultPositionRealUnit(address(_component)).toUint256().sub(_componentPositionUnits);
        _ckToken.editDefaultPosition(address(_component), newDefaultTokenUnit);
        
        int256 newExternalTokenUnit = _ckToken.getExternalPositionRealUnit(address(_component), address(this))
            .add(_componentPositionUnits.toInt256());
        _ckToken.editExternalPosition(address(_component), address(this), newExternalTokenUnit, "");
    }

    /**
     * Update positions on CKToken and tracking on StakingModule after unstaking is complete. Includes the following updates:
     *  - If paring down position then subtract positionUnits from existing position amount on StakingModule
     *  - If closing staking position remove _stakeContract from stakingContracts list and delete position entry in position mapping
     *    (on StakingModule)
     *  - Add to Default position of _component on CKToken
     *  - Subtract from external position of _component on CKToken referencing this module
     *
     * @param _ckToken                 Address of CKToken contract
     * @param _stakeContract            Address of staking contract
     * @param _component                Address of token being unstaked
     * @param _componentPositionUnits   Quantity of token to stake in position units
     */
    function _updateUnstakeState(
        ICKToken _ckToken,
        address _stakeContract,
        IERC20 _component,
        uint256 _componentPositionUnits
    )
        internal
    {   
        uint256 remainingPositionUnits = getStakingPositionUnit(_ckToken, _component, _stakeContract).sub(_componentPositionUnits);

        if (remainingPositionUnits > 0) {
            stakingPositions[_ckToken][_component].positions[_stakeContract].componentPositionUnits = remainingPositionUnits;
        } else {
            stakingPositions[_ckToken][_component].stakingContracts = getStakingContracts(_ckToken, _component).remove(_stakeContract);
            delete stakingPositions[_ckToken][_component].positions[_stakeContract];
        }

        uint256 newTokenUnit = _ckToken.getDefaultPositionRealUnit(address(_component)).toUint256().add(_componentPositionUnits);
        
        _ckToken.editDefaultPosition(address(_component), newTokenUnit);
        
        int256 newExternalTokenUnit = _ckToken.getExternalPositionRealUnit(address(_component), address(this))
            .sub(_componentPositionUnits.toInt256());
        
        _ckToken.editExternalPosition(address(_component), address(this), newExternalTokenUnit, "");
    }
}