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
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/SafeCast.sol";
import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";
import { SignedSafeMath } from "@openzeppelin/contracts/math/SignedSafeMath.sol";

import { IController } from "../../interfaces/IController.sol";
import { IManagerIssuanceHook } from "../../interfaces/IManagerIssuanceHook.sol";
import { IModuleIssuanceHook } from "../../interfaces/IModuleIssuanceHook.sol";
import { Invoke } from "../lib/Invoke.sol";
import { ICKToken } from "../../interfaces/ICKToken.sol";
import { ModuleBase } from "../lib/ModuleBase.sol";
import { Position } from "../lib/Position.sol";
import { PreciseUnitMath } from "../../lib/PreciseUnitMath.sol";

/**
 * @title IssuanceModule
 * @author Cook Finance
 *
 * The IssuanceModule is a module that enables users to issue and redeem CKTokens that contain default and 
 * non-debt external Positions. Managers are able to set an external contract hook that is called before an
 * issuance is called.
 */
contract IssuanceModule is ModuleBase, ReentrancyGuard {
    using Invoke for ICKToken;
    using Position for ICKToken;
    using PreciseUnitMath for uint256;
    using SafeMath for uint256;
    using SafeCast for int256;
    using SignedSafeMath for int256;

    /* ============ Events ============ */

    event CKTokenIssued(address indexed _ckToken, address _issuer, address _to, address _hookContract, uint256 _quantity);
    event CKTokenRedeemed(address indexed _ckToken, address _redeemer, address _to, uint256 _quantity);

    /* ============ State Variables ============ */

    // Mapping of CKToken to Issuance hook configurations
    mapping(ICKToken => IManagerIssuanceHook) public managerIssuanceHook;

    /* ============ Constructor ============ */

    /**
     * Set state controller state variable
     */
    constructor(IController _controller) public ModuleBase(_controller) {}

    /* ============ External Functions ============ */

    /**
     * Deposits components to the CKToken and replicates any external module component positions and mints 
     * the CKToken. Any issuances with CKTokens that have external positions with negative unit will revert.
     *
     * @param _ckToken             Instance of the CKToken contract
     * @param _quantity             Quantity of the CKToken to mint
     * @param _to                   Address to mint CKToken to
     */
    function issue(
        ICKToken _ckToken,
        uint256 _quantity,
        address _to
    ) 
        external
        nonReentrant
        onlyValidAndInitializedCK(_ckToken)
    {
        require(_quantity > 0, "Issue quantity must be > 0");

        address hookContract = _callPreIssueHooks(_ckToken, _quantity, msg.sender, _to);

        (
            address[] memory components,
            uint256[] memory componentQuantities
        ) = getRequiredComponentIssuanceUnits(_ckToken, _quantity, true);

        // For each position, transfer the required underlying to the CKToken and call external module hooks
        for (uint256 i = 0; i < components.length; i++) {
            transferFrom(
                IERC20(components[i]),
                msg.sender,
                address(_ckToken),
                componentQuantities[i]
            );

            _executeExternalPositionHooks(_ckToken, _quantity, IERC20(components[i]), true);
        }

        _ckToken.mint(_to, _quantity);

        emit CKTokenIssued(address(_ckToken), msg.sender, _to, hookContract, _quantity);
    }

    /**
     * Burns a user's CKToken of specified quantity, unwinds external positions, and returns components
     * to the specified address. Does not work for debt/negative external positions.
     *
     * @param _ckToken             Instance of the CKToken contract
     * @param _quantity             Quantity of the CKToken to redeem
     * @param _to                   Address to send component assets to
     */
    function redeem(
        ICKToken _ckToken,
        uint256 _quantity,
        address _to
    )
        external
        nonReentrant
        onlyValidAndInitializedCK(_ckToken)
    {
        require(_quantity > 0, "Redeem quantity must be > 0");

        _ckToken.burn(msg.sender, _quantity);

        (
            address[] memory components,
            uint256[] memory componentQuantities
        ) = getRequiredComponentIssuanceUnits(_ckToken, _quantity, false);

        for (uint256 i = 0; i < components.length; i++) {
            _executeExternalPositionHooks(_ckToken, _quantity, IERC20(components[i]), false);
            
            _ckToken.strictInvokeTransfer(
                components[i],
                _to,
                componentQuantities[i]
            );
        }

        emit CKTokenRedeemed(address(_ckToken), msg.sender, _to, _quantity);
    }

    /**
     * Initializes this module to the CKToken with issuance-related hooks. Only callable by the CKToken's manager.
     * Hook addresses are optional. Address(0) means that no hook will be called
     *
     * @param _ckToken             Instance of the CKToken to issue
     * @param _preIssueHook         Instance of the Manager Contract with the Pre-Issuance Hook function
     */
    function initialize(
        ICKToken _ckToken,
        IManagerIssuanceHook _preIssueHook
    )
        external
        onlyCKManager(_ckToken, msg.sender)
        onlyValidAndPendingCK(_ckToken)
    {
        managerIssuanceHook[_ckToken] = _preIssueHook;

        _ckToken.initializeModule();
    }

    /**
     * Reverts as this module should not be removable after added. Users should always
     * have a way to redeem their CKs
     */
    function removeModule() external override {
        revert("The IssuanceModule module cannot be removed");
    }

    /* ============ External Getter Functions ============ */

    /**
     * Retrieves the addresses and units required to issue/redeem a particular quantity of CKToken.
     *
     * @param _ckToken             Instance of the CKToken to issue
     * @param _quantity             Quantity of CKToken to issue
     * @param _isIssue              Boolean whether the quantity is issuance or redemption
     * @return address[]            List of component addresses
     * @return uint256[]            List of component units required for a given CKToken quantity
     */
    function getRequiredComponentIssuanceUnits(
        ICKToken _ckToken,
        uint256 _quantity,
        bool _isIssue
    )
        public
        view
        returns (address[] memory, uint256[] memory)
    {
        (
            address[] memory components,
            uint256[] memory issuanceUnits
        ) = _getTotalIssuanceUnits(_ckToken);

        uint256[] memory notionalUnits = new uint256[](components.length);
        for (uint256 i = 0; i < issuanceUnits.length; i++) {
            // Use preciseMulCeil to round up to ensure overcollateration when small issue quantities are provided
            // and preciseMul to round down to ensure overcollateration when small redeem quantities are provided
            notionalUnits[i] = _isIssue ? 
                issuanceUnits[i].preciseMulCeil(_quantity) : 
                issuanceUnits[i].preciseMul(_quantity);
        }

        return (components, notionalUnits);
    }

    /* ============ Internal Functions ============ */

    /**
     * Retrieves the component addresses and list of total units for components. This will revert if the external unit
     * is ever equal or less than 0 .
     */
    function _getTotalIssuanceUnits(ICKToken _ckToken) internal view returns (address[] memory, uint256[] memory) {
        address[] memory components = _ckToken.getComponents();
        uint256[] memory totalUnits = new uint256[](components.length);

        for (uint256 i = 0; i < components.length; i++) {
            address component = components[i];
            int256 cumulativeUnits = _ckToken.getDefaultPositionRealUnit(component);

            address[] memory externalModules = _ckToken.getExternalPositionModules(component);
            if (externalModules.length > 0) {
                for (uint256 j = 0; j < externalModules.length; j++) {
                    int256 externalPositionUnit = _ckToken.getExternalPositionRealUnit(component, externalModules[j]);

                    require(externalPositionUnit > 0, "Only positive external unit positions are supported");

                    cumulativeUnits = cumulativeUnits.add(externalPositionUnit);
                }
            }

            totalUnits[i] = cumulativeUnits.toUint256();
        }

        return (components, totalUnits);        
    }

    /**
     * If a pre-issue hook has been configured, call the external-protocol contract. Pre-issue hook logic
     * can contain arbitrary logic including validations, external function calls, etc.
     * Note: All modules with external positions must implement ExternalPositionIssueHooks
     */
    function _callPreIssueHooks(
        ICKToken _ckToken,
        uint256 _quantity,
        address _caller,
        address _to
    )
        internal
        returns(address)
    {
        IManagerIssuanceHook preIssueHook = managerIssuanceHook[_ckToken];
        if (address(preIssueHook) != address(0)) {
            preIssueHook.invokePreIssueHook(_ckToken, _quantity, _caller, _to);
            return address(preIssueHook);
        }

        return address(0);
    }

    /**
     * For each component's external module positions, calculate the total notional quantity, and 
     * call the module's issue hook or redeem hook.
     * Note: It is possible that these hooks can cause the states of other modules to change.
     * It can be problematic if the a hook called an external function that called back into a module, resulting in state inconsistencies.
     */
    function _executeExternalPositionHooks(
        ICKToken _ckToken,
        uint256 _ckTokenQuantity,
        IERC20 _component,
        bool isIssue
    )
        internal
    {
        address[] memory externalPositionModules = _ckToken.getExternalPositionModules(address(_component));
        for (uint256 i = 0; i < externalPositionModules.length; i++) {
            if (isIssue) {
                IModuleIssuanceHook(externalPositionModules[i]).componentIssueHook(_ckToken, _ckTokenQuantity, _component, true);
            } else {
                IModuleIssuanceHook(externalPositionModules[i]).componentRedeemHook(_ckToken, _ckTokenQuantity, _component, true);
            }
        }
    }
}
