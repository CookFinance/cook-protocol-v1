/*
    Copyright 2021 Cook Finance

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
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";

import { DebtIssuanceModule } from "./DebtIssuanceModule.sol";
import { IController } from "../../interfaces/IController.sol";
import { Invoke } from "../lib/Invoke.sol";
import { ICKToken } from "../../interfaces/ICKToken.sol";
import { IssuanceValidationUtils } from "../lib/IssuanceValidationUtils.sol";

/**
 * @title DebtIssuanceModuleV2
 * @author Cook Finance
 *
 * The DebtIssuanceModuleV2 is a module that enables users to issue and redeem CKTokens that contain default and all
 * external positions, including debt positions. Module hooks are added to allow for syncing of positions, and component
 * level hooks are added to ensure positions are replicated correctly. The manager can define arbitrary issuance logic
 * in the manager hook, as well as specify issue and redeem fees.
 * 
 * NOTE: 
 * DebtIssuanceModule contract confirmed increase/decrease in balance of component held by the CKToken after every transfer in/out
 * for each component during issuance/redemption. This contract replaces those strict checks with slightly looser checks which 
 * ensure that the CKToken remains collateralized after every transfer in/out for each component during issuance/redemption.
 * This module should be used to issue/redeem CKToken whose one or more components return a balance value with +/-1 wei error.
 * For example, this module can be used to issue/redeem CKTokens which has one or more aTokens as its components.
 */
contract DebtIssuanceModuleV2 is DebtIssuanceModule {
    
    /* ============ Constructor ============ */
    
    constructor(IController _controller) public DebtIssuanceModule(_controller) {}

    /* ============ External Functions ============ */

    /**
     * Deposits components to the CKToken, replicates any external module component positions and mints 
     * the CKToken. If the token has a debt position all collateral will be transferred in first then debt
     * will be returned to the minting address. If specified, a fee will be charged on issuance.
     *     
     * NOTE: Overrides DebtIssuanceModule#issue external function and adds undercollateralization checks in place of the
     * previous default strict balances checks. The undercollateralization checks are implemented in IssuanceValidationUtils library and they 
     * revert upon undercollateralization of the CKToken post component transfer.
     *
     * @param _ckToken          Instance of the CKToken to issue
     * @param _quantity         Quantity of CKToken to issue
     * @param _to               Address to mint CKToken to
     */
    function issue(
        ICKToken _ckToken,
        uint256 _quantity,
        address _to
    )
        external
        override
        nonReentrant
        onlyValidAndInitializedCK(_ckToken)
    {
        require(_quantity > 0, "Issue quantity must be > 0");

        address hookContract = _callManagerPreIssueHooks(_ckToken, _quantity, msg.sender, _to);

        _callModulePreIssueHooks(_ckToken, _quantity);

        
        uint256 initialCKSupply = _ckToken.totalSupply();

        (
            uint256 quantityWithFees,
            uint256 managerFee,
            uint256 protocolFee
        ) = calculateTotalFees(_ckToken, _quantity, true);

        // Prevent stack too deep
        {       
            (
                address[] memory components,
                uint256[] memory equityUnits,
                uint256[] memory debtUnits
            ) = _calculateRequiredComponentIssuanceUnits(_ckToken, quantityWithFees, true);

            uint256 finalCKSupply = initialCKSupply.add(quantityWithFees);

            _resolveEquityPositions(_ckToken, quantityWithFees, _to, true, components, equityUnits, initialCKSupply, finalCKSupply);
            _resolveDebtPositions(_ckToken, quantityWithFees, true, components, debtUnits, initialCKSupply, finalCKSupply);
            _resolveFees(_ckToken, managerFee, protocolFee);
        }
        
        _ckToken.mint(_to, _quantity);

        emit CKTokenIssued(
            _ckToken,
            msg.sender,
            _to,
            hookContract,
            _quantity,
            managerFee,
            protocolFee
        );
    }

    /**
     * Returns components from the CKToken, unwinds any external module component positions and burns the CKToken.
     * If the token has debt positions, the module transfers in the required debt amounts from the caller and uses
     * those funds to repay the debts on behalf of the CKToken. All debt will be paid down first then equity positions
     * will be returned to the minting address. If specified, a fee will be charged on redeem.
     *
     * NOTE: Overrides DebtIssuanceModule#redeem internal function and adds undercollateralization checks in place of the
     * previous default strict balances checks. The undercollateralization checks are implemented in IssuanceValidationUtils library 
     * and they revert upon undercollateralization of the CKToken post component transfer.
     *
     * @param _ckToken          Instance of the CKToken to redeem
     * @param _quantity         Quantity of CKToken to redeem
     * @param _to               Address to send collateral to
     */
    function redeem(
        ICKToken _ckToken,
        uint256 _quantity,
        address _to
    )
        external
        override        
        nonReentrant
        onlyValidAndInitializedCK(_ckToken)
    {
        require(_quantity > 0, "Redeem quantity must be > 0");

        _callModulePreRedeemHooks(_ckToken, _quantity);

        uint256 initialCKSupply = _ckToken.totalSupply();

        // Place burn after pre-redeem hooks because burning tokens may lead to false accounting of synced positions
        _ckToken.burn(msg.sender, _quantity);

        (
            uint256 quantityNetFees,
            uint256 managerFee,
            uint256 protocolFee
        ) = calculateTotalFees(_ckToken, _quantity, false);

        // Prevent stack too deep
        {
            (
                address[] memory components,
                uint256[] memory equityUnits,
                uint256[] memory debtUnits
            ) = _calculateRequiredComponentIssuanceUnits(_ckToken, quantityNetFees, false);

            uint256 finalCKSupply = initialCKSupply.sub(quantityNetFees);

            _resolveDebtPositions(_ckToken, quantityNetFees, false, components, debtUnits, initialCKSupply, finalCKSupply);
            _resolveEquityPositions(_ckToken, quantityNetFees, _to, false, components, equityUnits, initialCKSupply, finalCKSupply);
            _resolveFees(_ckToken, managerFee, protocolFee);
        }

        emit CKTokenRedeemed(
            _ckToken,
            msg.sender,
            _to,
            _quantity,
            managerFee,
            protocolFee
        );
    }

    /* ============ Internal Functions ============ */
    
    /**
     * Resolve equity positions associated with CKToken. On issuance, the total equity position for an asset (including default and external
     * positions) is transferred in. Then any external position hooks are called to transfer the external positions to their necessary place.
     * On redemption all external positions are recalled by the external position hook, then those position plus any default position are
     * transferred back to the _to address.
     */
    function _resolveEquityPositions(
        ICKToken _ckToken,
        uint256 _quantity,
        address _to,
        bool _isIssue,
        address[] memory _components,
        uint256[] memory _componentEquityQuantities,
        uint256 _initialCKSupply,
        uint256 _finalCKSupply
    )
        internal
    {
        for (uint256 i = 0; i < _components.length; i++) {
            address component = _components[i];
            uint256 componentQuantity = _componentEquityQuantities[i];
            if (componentQuantity > 0) {
                if (_isIssue) {
                    // Call SafeERC20#safeTransferFrom instead of ExplicitERC20#transferFrom
                    SafeERC20.safeTransferFrom(
                        IERC20(component),
                        msg.sender,
                        address(_ckToken),
                        componentQuantity
                    );

                    IssuanceValidationUtils.validateCollateralizationPostTransferInPreHook(_ckToken, component, _initialCKSupply, componentQuantity);

                    _executeExternalPositionHooks(_ckToken, _quantity, IERC20(component), true, true);
                } else {
                    _executeExternalPositionHooks(_ckToken, _quantity, IERC20(component), false, true);

                    // Call Invoke#invokeTransfer instead of Invoke#strictInvokeTransfer
                    _ckToken.invokeTransfer(component, _to, componentQuantity);

                    IssuanceValidationUtils.validateCollateralizationPostTransferOut(_ckToken, component, _finalCKSupply);
                }
            }
        }
    }

    /**
     * Resolve debt positions associated with CKToken. On issuance, debt positions are entered into by calling the external position hook. The
     * resulting debt is then returned to the calling address. On redemption, the module transfers in the required debt amount from the caller
     * and uses those funds to repay the debt on behalf of the CKToken.
     */
    function _resolveDebtPositions(
        ICKToken _ckToken,
        uint256 _quantity,
        bool _isIssue,
        address[] memory _components,
        uint256[] memory _componentDebtQuantities,
        uint256 _initialCKSupply,
        uint256 _finalCKSupply
    )
        internal
    {
        for (uint256 i = 0; i < _components.length; i++) {
            address component = _components[i];
            uint256 componentQuantity = _componentDebtQuantities[i];
            if (componentQuantity > 0) {
                if (_isIssue) {
                    _executeExternalPositionHooks(_ckToken, _quantity, IERC20(component), true, false);
                    
                    // Call Invoke#invokeTransfer instead of Invoke#strictInvokeTransfer
                    _ckToken.invokeTransfer(component, msg.sender, componentQuantity);

                    IssuanceValidationUtils.validateCollateralizationPostTransferOut(_ckToken, component, _finalCKSupply);
                } else {
                    // Call SafeERC20#safeTransferFrom instead of ExplicitERC20#transferFrom
                    SafeERC20.safeTransferFrom(
                        IERC20(component),
                        msg.sender,
                        address(_ckToken),
                        componentQuantity
                    );

                    IssuanceValidationUtils.validateCollateralizationPostTransferInPreHook(_ckToken, component, _initialCKSupply, componentQuantity);

                    _executeExternalPositionHooks(_ckToken, _quantity, IERC20(component), false, false);
                }
            }
        }
    }
}