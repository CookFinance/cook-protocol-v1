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

import { AddressArrayUtils } from "../../lib/AddressArrayUtils.sol";
import { IController } from "../../interfaces/IController.sol";
import { IManagerIssuanceHook } from "../../interfaces/IManagerIssuanceHook.sol";
import { IModuleIssuanceHook } from "../../interfaces/IModuleIssuanceHook.sol";
import { Invoke } from "../lib/Invoke.sol";
import { ICKToken } from "../../interfaces/ICKToken.sol";
import { ModuleBase } from "../lib/ModuleBase.sol";
import { Position } from "../lib/Position.sol";
import { PreciseUnitMath } from "../../lib/PreciseUnitMath.sol";


/**
 * @title DebtIssuanceModule
 * @author Cook Finance
 *
 * The DebtIssuanceModule is a module that enables users to issue and redeem CKTokens that contain default and all
 * external positions, including debt positions. Module hooks are added to allow for syncing of positions, and component
 * level hooks are added to ensure positions are replicated correctly. The manager can define arbitrary issuance logic
 * in the manager hook, as well as specify issue and redeem fees.
 */
contract DebtIssuanceModule is ModuleBase, ReentrancyGuard {

    /* ============ Structs ============ */

    // NOTE: moduleIssuanceHooks uses address[] for compatibility with AddressArrayUtils library
    struct IssuanceSettings {
        uint256 maxManagerFee;                          // Max issue/redeem fee defined on instantiation
        uint256 managerIssueFee;                        // Current manager issuance fees in precise units (10^16 = 1%)
        uint256 managerRedeemFee;                       // Current manager redeem fees in precise units (10^16 = 1%)
        address feeRecipient;                           // Address that receives all manager issue and redeem fees
        IManagerIssuanceHook managerIssuanceHook;       // Instance of manager defined hook, can hold arbitrary logic
        address[] moduleIssuanceHooks;                  // Array of modules that are registered with this module
        mapping(address => bool) isModuleHook;          // Mapping of modules to if they've registered a hook
    }

    /* ============ Events ============ */

    event CKTokenIssued(
        ICKToken indexed _ckToken,
        address indexed _issuer,
        address indexed _to,
        address _hookContract,
        uint256 _quantity,
        uint256 _managerFee,
        uint256 _protocolFee
    );
    event CKTokenRedeemed(
        ICKToken indexed _ckToken,
        address indexed _redeemer,
        address indexed _to,
        uint256 _quantity,
        uint256 _managerFee,
        uint256 _protocolFee
    );
    event FeeRecipientUpdated(ICKToken indexed _ckToken, address _newFeeRecipient);
    event IssueFeeUpdated(ICKToken indexed _ckToken, uint256 _newIssueFee);
    event RedeemFeeUpdated(ICKToken indexed _ckToken, uint256 _newRedeemFee);

    /* ============ Constants ============ */

    uint256 private constant ISSUANCE_MODULE_PROTOCOL_FEE_SPLIT_INDEX = 0;

    /* ============ State ============ */

    mapping(ICKToken => IssuanceSettings) public issuanceSettings;

    /* ============ Constructor ============ */

    constructor(IController _controller) public ModuleBase(_controller) {}

    /* ============ External Functions ============ */

    /**
     * Deposits components to the CKToken, replicates any external module component positions and mints 
     * the CKToken. If the token has a debt position all collateral will be transferred in first then debt
     * will be returned to the minting address. If specified, a fee will be charged on issuance.
     *
     * @param _ckToken         Instance of the CKToken to issue
     * @param _quantity         Quantity of CKToken to issue
     * @param _to               Address to mint CKToken to
     */
    function issue(
        ICKToken _ckToken,
        uint256 _quantity,
        address _to
    )
        external
        virtual
        nonReentrant
        onlyValidAndInitializedCK(_ckToken)
    {
        require(_quantity > 0, "Issue quantity must be > 0");

        address hookContract = _callManagerPreIssueHooks(_ckToken, _quantity, msg.sender, _to);

        _callModulePreIssueHooks(_ckToken, _quantity);

        (
            uint256 quantityWithFees,
            uint256 managerFee,
            uint256 protocolFee
        ) = calculateTotalFees(_ckToken, _quantity, true);

        (
            address[] memory components,
            uint256[] memory equityUnits,
            uint256[] memory debtUnits
        ) = _calculateRequiredComponentIssuanceUnits(_ckToken, quantityWithFees, true);

        _resolveEquityPositions(_ckToken, quantityWithFees, _to, true, components, equityUnits);
        _resolveDebtPositions(_ckToken, quantityWithFees, true, components, debtUnits);
        _resolveFees(_ckToken, managerFee, protocolFee);

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
     * @param _ckToken         Instance of the CKToken to redeem
     * @param _quantity         Quantity of CKToken to redeem
     * @param _to               Address to send collateral to
     */
    function redeem(
        ICKToken _ckToken,
        uint256 _quantity,
        address _to
    )
        external
        virtual
        nonReentrant
        onlyValidAndInitializedCK(_ckToken)
    {
        require(_quantity > 0, "Redeem quantity must be > 0");

        _callModulePreRedeemHooks(_ckToken, _quantity);

        // Place burn after pre-redeem hooks because burning tokens may lead to false accounting of synced positions
        _ckToken.burn(msg.sender, _quantity);

        (
            uint256 quantityNetFees,
            uint256 managerFee,
            uint256 protocolFee
        ) = calculateTotalFees(_ckToken, _quantity, false);

        (
            address[] memory components,
            uint256[] memory equityUnits,
            uint256[] memory debtUnits
        ) = _calculateRequiredComponentIssuanceUnits(_ckToken, quantityNetFees, false);

        _resolveDebtPositions(_ckToken, quantityNetFees, false, components, debtUnits);
        _resolveEquityPositions(_ckToken, quantityNetFees, _to, false, components, equityUnits);
        _resolveFees(_ckToken, managerFee, protocolFee);

        emit CKTokenRedeemed(
            _ckToken,
            msg.sender,
            _to,
            _quantity,
            managerFee,
            protocolFee
        );
    }

    /**
     * MANAGER ONLY: Updates address receiving issue/redeem fees for a given CKToken.
     *
     * @param _ckToken             Instance of the CKToken to update fee recipient
     * @param _newFeeRecipient      New fee recipient address
     */
    function updateFeeRecipient(
        ICKToken _ckToken,
        address _newFeeRecipient
    )
        external
        onlyManagerAndValidCK(_ckToken)
    {
        require(_newFeeRecipient != address(0), "Fee Recipient must be non-zero address.");
        require(_newFeeRecipient != issuanceSettings[_ckToken].feeRecipient, "Same fee recipient passed");

        issuanceSettings[_ckToken].feeRecipient = _newFeeRecipient;

        emit FeeRecipientUpdated(_ckToken, _newFeeRecipient);
    }

    /**
     * MANAGER ONLY: Updates issue fee for passed CKToken
     *
     * @param _ckToken             Instance of the CKToken to update issue fee
     * @param _newIssueFee          New fee amount in preciseUnits (1% = 10^16)
     */
    function updateIssueFee(
        ICKToken _ckToken,
        uint256 _newIssueFee
    )
        external
        onlyManagerAndValidCK(_ckToken)
    {
        require(_newIssueFee <= issuanceSettings[_ckToken].maxManagerFee, "Issue fee can't exceed maximum");
        require(_newIssueFee != issuanceSettings[_ckToken].managerIssueFee, "Same issue fee passed");

        issuanceSettings[_ckToken].managerIssueFee = _newIssueFee;

        emit IssueFeeUpdated(_ckToken, _newIssueFee);
    }

    /**
     * MANAGER ONLY: Updates redeem fee for passed CKToken
     *
     * @param _ckToken             Instance of the CKToken to update redeem fee
     * @param _newRedeemFee         New fee amount in preciseUnits (1% = 10^16)
     */
    function updateRedeemFee(
        ICKToken _ckToken,
        uint256 _newRedeemFee
    )
        external
        onlyManagerAndValidCK(_ckToken)
    {
        require(_newRedeemFee <= issuanceSettings[_ckToken].maxManagerFee, "Redeem fee can't exceed maximum");
        require(_newRedeemFee != issuanceSettings[_ckToken].managerRedeemFee, "Same redeem fee passed");

        issuanceSettings[_ckToken].managerRedeemFee = _newRedeemFee;

        emit RedeemFeeUpdated(_ckToken, _newRedeemFee);
    }

    /**
     * MODULE ONLY: Adds calling module to array of modules that require they be called before component hooks are
     * called. Can be used to sync debt positions before issuance.
     *
     * @param _ckToken             Instance of the CKToken to issue
     */
    function registerToIssuanceModule(ICKToken _ckToken) external onlyModule(_ckToken) onlyValidAndInitializedCK(_ckToken) {
        require(!issuanceSettings[_ckToken].isModuleHook[msg.sender], "Module already registered.");
        issuanceSettings[_ckToken].moduleIssuanceHooks.push(msg.sender);
        issuanceSettings[_ckToken].isModuleHook[msg.sender] = true;
    }

    /**
     * MODULE ONLY: Removes calling module from array of modules that require they be called before component hooks are
     * called.
     *
     * @param _ckToken             Instance of the CKToken to issue
     */
    function unregisterFromIssuanceModule(ICKToken _ckToken) external onlyModule(_ckToken) onlyValidAndInitializedCK(_ckToken) {
        require(issuanceSettings[_ckToken].isModuleHook[msg.sender], "Module not registered.");
        issuanceSettings[_ckToken].moduleIssuanceHooks.removeStorage(msg.sender);
        issuanceSettings[_ckToken].isModuleHook[msg.sender] = false;
    }

    /**
     * MANAGER ONLY: Initializes this module to the CKToken with issuance-related hooks and fee information. Only callable
     * by the CKToken's manager. Hook addresses are optional. Address(0) means that no hook will be called
     *
     * @param _ckToken                     Instance of the CKToken to issue
     * @param _maxManagerFee                Maximum fee that can be charged on issue and redeem
     * @param _managerIssueFee              Fee to charge on issuance
     * @param _managerRedeemFee             Fee to charge on redemption
     * @param _feeRecipient                 Address to send fees to
     * @param _managerIssuanceHook          Instance of the Manager Contract with the Pre-Issuance Hook function
     */
    function initialize(
        ICKToken _ckToken,
        uint256 _maxManagerFee,
        uint256 _managerIssueFee,
        uint256 _managerRedeemFee,
        address _feeRecipient,
        IManagerIssuanceHook _managerIssuanceHook
    )
        external
        onlyCKManager(_ckToken, msg.sender)
        onlyValidAndPendingCK(_ckToken)
    {
        require(_managerIssueFee <= _maxManagerFee, "Issue fee can't exceed maximum fee");
        require(_managerRedeemFee <= _maxManagerFee, "Redeem fee can't exceed maximum fee");

        issuanceSettings[_ckToken] = IssuanceSettings({
            maxManagerFee: _maxManagerFee,
            managerIssueFee: _managerIssueFee,
            managerRedeemFee: _managerRedeemFee,
            feeRecipient: _feeRecipient,
            managerIssuanceHook: _managerIssuanceHook,
            moduleIssuanceHooks: new address[](0)
        });

        _ckToken.initializeModule();
    }

    /**
     * CK TOKEN ONLY: Allows removal of module (and deletion of state) if no other modules are registered.
     */
    function removeModule() external override {
        require(issuanceSettings[ICKToken(msg.sender)].moduleIssuanceHooks.length == 0, "Registered modules must be removed.");
        delete issuanceSettings[ICKToken(msg.sender)];
    }

    /* ============ External View Functions ============ */

    /**
     * Calculates the manager fee, protocol fee and resulting totalQuantity to use when calculating unit amounts. If fees are charged they
     * are added to the total issue quantity, for example 1% fee on 100 CKs means 101 CKs are minted by caller, the _to address receives
     * 100 and the feeRecipient receives 1. Conversely, on redemption the redeemer will only receive the collateral that collateralizes 99
     * CKs, while the additional CK is given to the feeRecipient.
     *
     * @param _ckToken                 Instance of the CKToken to issue
     * @param _quantity                 Amount of CKToken issuer wants to receive/redeem
     * @param _isIssue                  If issuing or redeeming
     *
     * @return totalQuantity           Total amount of CKs to be issued/redeemed with fee adjustment
     * @return managerFee              CKs minted to the manager
     * @return protocolFee             CKs minted to the protocol
     */
    function calculateTotalFees(
        ICKToken _ckToken,
        uint256 _quantity,
        bool _isIssue
    )
        public
        view
        returns (uint256 totalQuantity, uint256 managerFee, uint256 protocolFee)
    {
        IssuanceSettings memory setIssuanceSettings = issuanceSettings[_ckToken];
        uint256 protocolFeeSplit = controller.getModuleFee(address(this), ISSUANCE_MODULE_PROTOCOL_FEE_SPLIT_INDEX);
        uint256 totalFeeRate = _isIssue ? setIssuanceSettings.managerIssueFee : setIssuanceSettings.managerRedeemFee;
        
        uint256 totalFee = totalFeeRate.preciseMul(_quantity);
        protocolFee = totalFee.preciseMul(protocolFeeSplit);
        managerFee = totalFee.sub(protocolFee);

        totalQuantity = _isIssue ? _quantity.add(totalFee) : _quantity.sub(totalFee);
    }

    /**
     * Calculates the amount of each component needed to collateralize passed issue quantity plus fees of CKs as well as amount of debt
     * that will be returned to caller. Values DO NOT take into account any updates from pre action manager or module hooks.
     *
     * @param _ckToken         Instance of the CKToken to issue
     * @param _quantity         Amount of CKs to be issued
     *
     * @return address[]        Array of component addresses making up the CK
     * @return uint256[]        Array of equity notional amounts of each component, respectively, represented as uint256
     * @return uint256[]        Array of debt notional amounts of each component, respectively, represented as uint256
     */
    function getRequiredComponentIssuanceUnits(
        ICKToken _ckToken,
        uint256 _quantity
    )
        external
        view
        returns (address[] memory, uint256[] memory, uint256[] memory)
    {
        (
            uint256 totalQuantity,,
        ) = calculateTotalFees(_ckToken, _quantity, true);

        return _calculateRequiredComponentIssuanceUnits(_ckToken, totalQuantity, true);
    }

    /**
     * Calculates the amount of each component will be returned on redemption net of fees as well as how much debt needs to be paid down to.
     * redeem. Values DO NOT take into account any updates from pre action manager or module hooks.
     *
     * @param _ckToken         Instance of the CKToken to issue
     * @param _quantity         Amount of CKs to be redeemed
     *
     * @return address[]        Array of component addresses making up the CK
     * @return uint256[]        Array of equity notional amounts of each component, respectively, represented as uint256
     * @return uint256[]        Array of debt notional amounts of each component, respectively, represented as uint256
     */
    function getRequiredComponentRedemptionUnits(
        ICKToken _ckToken,
        uint256 _quantity
    )
        external
        view
        returns (address[] memory, uint256[] memory, uint256[] memory)
    {
        (
            uint256 totalQuantity,,
        ) = calculateTotalFees(_ckToken, _quantity, false);

        return _calculateRequiredComponentIssuanceUnits(_ckToken, totalQuantity, false);
    }

    function getModuleIssuanceHooks(ICKToken _ckToken) external view returns(address[] memory) {
        return issuanceSettings[_ckToken].moduleIssuanceHooks;
    }

    function isModuleIssuanceHook(ICKToken _ckToken, address _hook) external view returns(bool) {
        return issuanceSettings[_ckToken].isModuleHook[_hook];
    }

    /* ============ Internal Functions ============ */

    /**
     * Calculates the amount of each component needed to collateralize passed issue quantity of CKs as well as amount of debt that will
     * be returned to caller. Can also be used to determine how much collateral will be returned on redemption as well as how much debt
     * needs to be paid down to redeem.
     *
     * @param _ckToken         Instance of the CKToken to issue
     * @param _quantity         Amount of CKs to be issued/redeemed
     * @param _isIssue          Whether CKs are being issued or redeemed
     *
     * @return address[]        Array of component addresses making up the CK
     * @return uint256[]        Array of equity notional amounts of each component, respectively, represented as uint256
     * @return uint256[]        Array of debt notional amounts of each component, respectively, represented as uint256
     */
    function _calculateRequiredComponentIssuanceUnits(
        ICKToken _ckToken,
        uint256 _quantity,
        bool _isIssue
    )
        internal
        view
        returns (address[] memory, uint256[] memory, uint256[] memory)
    {
        (
            address[] memory components,
            uint256[] memory equityUnits,
            uint256[] memory debtUnits
        ) = _getTotalIssuanceUnits(_ckToken);

        uint256 componentsLength = components.length;
        uint256[] memory totalEquityUnits = new uint256[](componentsLength);
        uint256[] memory totalDebtUnits = new uint256[](componentsLength);
        for (uint256 i = 0; i < components.length; i++) {
            // Use preciseMulCeil to round up to ensure overcollateration when small issue quantities are provided
            // and preciseMul to round down to ensure overcollateration when small redeem quantities are provided
            totalEquityUnits[i] = _isIssue ?
                equityUnits[i].preciseMulCeil(_quantity) :
                equityUnits[i].preciseMul(_quantity);

            totalDebtUnits[i] = _isIssue ?
                debtUnits[i].preciseMul(_quantity) :
                debtUnits[i].preciseMulCeil(_quantity);
        }

        return (components, totalEquityUnits, totalDebtUnits);
    }

    /**
     * Sums total debt and equity units for each component, taking into account default and external positions.
     *
     * @param _ckToken         Instance of the CKToken to issue
     *
     * @return address[]        Array of component addresses making up the CK
     * @return uint256[]        Array of equity unit amounts of each component, respectively, represented as uint256
     * @return uint256[]        Array of debt unit amounts of each component, respectively, represented as uint256
     */
    function _getTotalIssuanceUnits(
        ICKToken _ckToken
    )
        internal
        view
        returns (address[] memory, uint256[] memory, uint256[] memory)
    {
        address[] memory components = _ckToken.getComponents();
        uint256 componentsLength = components.length;

        uint256[] memory equityUnits = new uint256[](componentsLength);
        uint256[] memory debtUnits = new uint256[](componentsLength);

        for (uint256 i = 0; i < components.length; i++) {
            address component = components[i];
            int256 cumulativeEquity = _ckToken.getDefaultPositionRealUnit(component);
            int256 cumulativeDebt = 0;
            address[] memory externalPositions = _ckToken.getExternalPositionModules(component);

            if (externalPositions.length > 0) {
                for (uint256 j = 0; j < externalPositions.length; j++) { 
                    int256 externalPositionUnit = _ckToken.getExternalPositionRealUnit(component, externalPositions[j]);

                    // If positionUnit <= 0 it will be "added" to debt position
                    if (externalPositionUnit > 0) {
                        cumulativeEquity = cumulativeEquity.add(externalPositionUnit);
                    } else {
                        cumulativeDebt = cumulativeDebt.add(externalPositionUnit);
                    }
                }
            }

            equityUnits[i] = cumulativeEquity.toUint256();
            debtUnits[i] = cumulativeDebt.mul(-1).toUint256();
        }

        return (components, equityUnits, debtUnits);
    }

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
        uint256[] memory _componentEquityQuantities
    )
        internal
    {
        for (uint256 i = 0; i < _components.length; i++) {
            address component = _components[i];
            uint256 componentQuantity = _componentEquityQuantities[i];
            if (componentQuantity > 0) {
                if (_isIssue) {
                    transferFrom(
                        IERC20(component),
                        msg.sender,
                        address(_ckToken),
                        componentQuantity
                    );

                    _executeExternalPositionHooks(_ckToken, _quantity, IERC20(component), true, true);
                } else {
                    _executeExternalPositionHooks(_ckToken, _quantity, IERC20(component), false, true);

                    _ckToken.strictInvokeTransfer(
                        component,
                        _to,
                        componentQuantity
                    );
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
        uint256[] memory _componentDebtQuantities
    )
        internal
    {
        for (uint256 i = 0; i < _components.length; i++) {
            address component = _components[i];
            uint256 componentQuantity = _componentDebtQuantities[i];
            if (componentQuantity > 0) {
                if (_isIssue) {
                    _executeExternalPositionHooks(_ckToken, _quantity, IERC20(component), true, false);
                    _ckToken.strictInvokeTransfer(
                        component,
                        msg.sender,
                        componentQuantity
                    );
                } else {
                    transferFrom(
                        IERC20(component),
                        msg.sender,
                        address(_ckToken),
                        componentQuantity
                    );
                    _executeExternalPositionHooks(_ckToken, _quantity, IERC20(component), false, false);
                }
            }
        }
    }

    /**
     * If any manager fees mints CKs to the defined feeRecipient. If protocol fee is enabled mints CKs to protocol
     * feeRecipient. 
     */
    function _resolveFees(ICKToken _ckToken, uint256 managerFee, uint256 protocolFee) internal {
        if (managerFee > 0) {
            _ckToken.mint(issuanceSettings[_ckToken].feeRecipient, managerFee);

            // Protocol fee check is inside manager fee check because protocol fees are only collected on manager fees
            if (protocolFee > 0) {
                _ckToken.mint(controller.feeRecipient(), protocolFee);
            }
        }
    }

    /**
     * If a pre-issue hook has been configured, call the external-protocol contract. Pre-issue hook logic
     * can contain arbitrary logic including validations, external function calls, etc.
     */
    function _callManagerPreIssueHooks(
        ICKToken _ckToken,
        uint256 _quantity,
        address _caller,
        address _to
    )
        internal
        returns(address)
    {
        IManagerIssuanceHook preIssueHook = issuanceSettings[_ckToken].managerIssuanceHook;
        if (address(preIssueHook) != address(0)) {
            preIssueHook.invokePreIssueHook(_ckToken, _quantity, _caller, _to);
            return address(preIssueHook);
        }

        return address(0);
    }
    
    /**
     * Calls all modules that have registered with the DebtIssuanceModule that have a moduleIssueHook.
     */
    function _callModulePreIssueHooks(ICKToken _ckToken, uint256 _quantity) internal {
        address[] memory issuanceHooks = issuanceSettings[_ckToken].moduleIssuanceHooks;
        for (uint256 i = 0; i < issuanceHooks.length; i++) {
            IModuleIssuanceHook(issuanceHooks[i]).moduleIssueHook(_ckToken, _quantity);
        }
    }

    /**
     * Calls all modules that have registered with the DebtIssuanceModule that have a moduleRedeemHook.
     */
    function _callModulePreRedeemHooks(ICKToken _ckToken, uint256 _quantity) internal {
        address[] memory issuanceHooks = issuanceSettings[_ckToken].moduleIssuanceHooks;
        for (uint256 i = 0; i < issuanceHooks.length; i++) {
            IModuleIssuanceHook(issuanceHooks[i]).moduleRedeemHook(_ckToken, _quantity);
        }
    }

    /**
     * For each component's external module positions, calculate the total notional quantity, and 
     * call the module's issue hook or redeem hook.
     * Note: It is possible that these hooks can cause the states of other modules to change.
     * It can be problematic if the hook called an external function that called back into a module, resulting in state inconsistencies.
     */
    function _executeExternalPositionHooks(
        ICKToken _ckToken,
        uint256 _ckTokenQuantity,
        IERC20 _component,
        bool _isIssue,
        bool _isEquity
    )
        internal
    {
        address[] memory externalPositionModules = _ckToken.getExternalPositionModules(address(_component));
        uint256 modulesLength = externalPositionModules.length;
        if (_isIssue) {
            for (uint256 i = 0; i < modulesLength; i++) {
                IModuleIssuanceHook(externalPositionModules[i]).componentIssueHook(_ckToken, _ckTokenQuantity, _component, _isEquity);
            }
        } else {
            for (uint256 i = 0; i < modulesLength; i++) {
                IModuleIssuanceHook(externalPositionModules[i]).componentRedeemHook(_ckToken, _ckTokenQuantity, _component, _isEquity);
            }
        }
    }
}