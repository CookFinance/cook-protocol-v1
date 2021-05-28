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

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { AddressArrayUtils } from "../../lib/AddressArrayUtils.sol";
import { ExplicitERC20 } from "../../lib/ExplicitERC20.sol";
import { IController } from "../../interfaces/IController.sol";
import { IModule } from "../../interfaces/IModule.sol";
import { ICKToken } from "../../interfaces/ICKToken.sol";
import { Invoke } from "./Invoke.sol";
import { Position } from "./Position.sol";
import { PreciseUnitMath } from "../../lib/PreciseUnitMath.sol";
import { ResourceIdentifier } from "./ResourceIdentifier.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/SafeCast.sol";
import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";
import { SignedSafeMath } from "@openzeppelin/contracts/math/SignedSafeMath.sol";

/**
 * @title ModuleBase
 * @author Cook Finance
 *
 * Abstract class that houses common Module-related state and functions.
 */
abstract contract ModuleBase is IModule {
    using AddressArrayUtils for address[];
    using Invoke for ICKToken;
    using Position for ICKToken;
    using PreciseUnitMath for uint256;
    using ResourceIdentifier for IController;
    using SafeCast for int256;
    using SafeCast for uint256;
    using SafeMath for uint256;
    using SignedSafeMath for int256;

    /* ============ State Variables ============ */

    // Address of the controller
    IController public controller;

    /* ============ Modifiers ============ */

    modifier onlyManagerAndValidCK(ICKToken _ckToken) { 
        _validateOnlyManagerAndValidCK(_ckToken);
        _;
    }

    modifier onlyCKManager(ICKToken _ckToken, address _caller) {
        _validateOnlyCKManager(_ckToken, _caller);
        _;
    }

    modifier onlyValidAndInitializedCK(ICKToken _ckToken) {
        _validateOnlyValidAndInitializedCK(_ckToken);
        _;
    }

    /**
     * Throws if the sender is not a CKToken's module or module not enabled
     */
    modifier onlyModule(ICKToken _ckToken) {
        _validateOnlyModule(_ckToken);
        _;
    }

    /**
     * Utilized during module initializations to check that the module is in pending state
     * and that the CKToken is valid
     */
    modifier onlyValidAndPendingCK(ICKToken _ckToken) {
        _validateOnlyValidAndPendingCK(_ckToken);
        _;
    }

    /* ============ Constructor ============ */

    /**
     * Set state variables and map asset pairs to their oracles
     *
     * @param _controller             Address of controller contract
     */
    constructor(IController _controller) public {
        controller = _controller;
    }

    /* ============ Internal Functions ============ */

    /**
     * Transfers tokens from an address (that has set allowance on the module).
     *
     * @param  _token          The address of the ERC20 token
     * @param  _from           The address to transfer from
     * @param  _to             The address to transfer to
     * @param  _quantity       The number of tokens to transfer
     */
    function transferFrom(IERC20 _token, address _from, address _to, uint256 _quantity) internal {
        ExplicitERC20.transferFrom(_token, _from, _to, _quantity);
    }

    /**
     * Gets the integration for the module with the passed in name. Validates that the address is not empty
     */
    function getAndValidateAdapter(string memory _integrationName) internal view returns(address) { 
        bytes32 integrationHash = getNameHash(_integrationName);
        return getAndValidateAdapterWithHash(integrationHash);
    }

    /**
     * Gets the integration for the module with the passed in hash. Validates that the address is not empty
     */
    function getAndValidateAdapterWithHash(bytes32 _integrationHash) internal view returns(address) { 
        address adapter = controller.getIntegrationRegistry().getIntegrationAdapterWithHash(
            address(this),
            _integrationHash
        );

        require(adapter != address(0), "Must be valid adapter"); 
        return adapter;
    }

    /**
     * Gets the total fee for this module of the passed in index (fee % * quantity)
     */
    function getModuleFee(uint256 _feeIndex, uint256 _quantity) internal view returns(uint256) {
        uint256 feePercentage = controller.getModuleFee(address(this), _feeIndex);
        return _quantity.preciseMul(feePercentage);
    }

    /**
     * Pays the _feeQuantity from the _ckToken denominated in _token to the protocol fee recipient
     */
    function payProtocolFeeFromCKToken(ICKToken _ckToken, address _token, uint256 _feeQuantity) internal {
        if (_feeQuantity > 0) {
            _ckToken.strictInvokeTransfer(_token, controller.feeRecipient(), _feeQuantity); 
        }
    }

    /**
     * Returns true if the module is in process of initialization on the CKToken
     */
    function isCKPendingInitialization(ICKToken _ckToken) internal view returns(bool) {
        return _ckToken.isPendingModule(address(this));
    }

    /**
     * Returns true if the address is the CKToken's manager
     */
    function isCKManager(ICKToken _ckToken, address _toCheck) internal view returns(bool) {
        return _ckToken.manager() == _toCheck;
    }

    /**
     * Returns true if CKToken must be enabled on the controller 
     * and module is registered on the CKToken
     */
    function isCKValidAndInitialized(ICKToken _ckToken) internal view returns(bool) {
        return controller.isCK(address(_ckToken)) &&
            _ckToken.isInitializedModule(address(this));
    }

    /**
     * Hashes the string and returns a bytes32 value
     */
    function getNameHash(string memory _name) internal pure returns(bytes32) {
        return keccak256(bytes(_name));
    }

    /* ============== Modifier Helpers ===============
     * Internal functions used to reduce bytecode size
     */

    /**
     * Caller must CKToken manager and CKToken must be valid and initialized
     */
    function _validateOnlyManagerAndValidCK(ICKToken _ckToken) internal view {
       require(isCKManager(_ckToken, msg.sender), "Must be the CKToken manager");
       require(isCKValidAndInitialized(_ckToken), "Must be a valid and initialized CKToken");
    }

    /**
     * Caller must CKToken manager
     */
    function _validateOnlyCKManager(ICKToken _ckToken, address _caller) internal view {
        require(isCKManager(_ckToken, _caller), "Must be the CKToken manager");
    }

    /**
     * CKToken must be valid and initialized
     */
    function _validateOnlyValidAndInitializedCK(ICKToken _ckToken) internal view {
        require(isCKValidAndInitialized(_ckToken), "Must be a valid and initialized CKToken");
    }

    /**
     * Caller must be initialized module and module must be enabled on the controller
     */
    function _validateOnlyModule(ICKToken _ckToken) internal view {
        require(
            _ckToken.moduleStates(msg.sender) == ICKToken.ModuleState.INITIALIZED,
            "Only the module can call"
        );

        require(
            controller.isModule(msg.sender),
            "Module must be enabled on controller"
        );
    }

    /**
     * CKToken must be in a pending state and module must be in pending state
     */
    function _validateOnlyValidAndPendingCK(ICKToken _ckToken) internal view {
        require(controller.isCK(address(_ckToken)), "Must be controller-enabled CKToken");
        require(isCKPendingInitialization(_ckToken), "Must be pending initialization");
    }
}