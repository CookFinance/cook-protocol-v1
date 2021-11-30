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

import { AddressArrayUtils } from "../../lib/AddressArrayUtils.sol";
import { IController } from "../../interfaces/IController.sol";
import { ICKToken } from "../../interfaces/ICKToken.sol";
import { Invoke } from "../lib/Invoke.sol";
import { ModuleBase } from "../lib/ModuleBase.sol";
import { Position } from "../lib/Position.sol";
import { PreciseUnitMath } from "../../lib/PreciseUnitMath.sol";


/**
 * @title AirdropModule
 * @author Cook Finance
 *
 * Module that enables managers to absorb tokens sent to the CKToken into the token's positions. With each CKToken,
 * managers are able to specify 1) the airdrops they want to include, 2) an airdrop fee recipient, 3) airdrop fee,
 * and 4) whether all users are allowed to trigger an airdrop.
 */
contract AirdropModule is ModuleBase, ReentrancyGuard {
    using PreciseUnitMath for uint256;
    using SafeMath for uint256;
    using Position for uint256;
    using SafeCast for int256;
    using AddressArrayUtils for address[];
    using Invoke for ICKToken;
    using Position for ICKToken;

    /* ============ Structs ============ */
    
    struct AirdropSettings {
        address[] airdrops;                     // Array of tokens manager is allowing to be absorbed
        address feeRecipient;                   // Address airdrop fees are sent to
        uint256 airdropFee;                     // Percentage in preciseUnits of airdrop sent to feeRecipient (1e16 = 1%)
        bool anyoneAbsorb;                      // Boolean indicating if any address can call absorb or just the manager
    }

    /* ============ Events ============ */

    event ComponentAbsorbed(
        ICKToken indexed _ckToken,
        IERC20 indexed _absorbedToken,
        uint256 _absorbedQuantity,
        uint256 _managerFee,
        uint256 _protocolFee
    );

    event AirdropComponentAdded(ICKToken indexed _ckToken, IERC20 indexed _component);
    event AirdropComponentRemoved(ICKToken indexed _ckToken, IERC20 indexed _component);
    event AnyoneAbsorbUpdated(ICKToken indexed _ckToken, bool _anyoneAbsorb);
    event AirdropFeeUpdated(ICKToken indexed _ckToken, uint256 _newFee);
    event FeeRecipientUpdated(ICKToken indexed _ckToken, address _newFeeRecipient);

    /* ============ Modifiers ============ */

    /**
     * Throws if claim is confined to the manager and caller is not the manager
     */
    modifier onlyValidCaller(ICKToken _ckToken) {
        require(_isValidCaller(_ckToken), "Must be valid caller");
        _;
    }

    /* ============ Constants ============ */

    uint256 public constant AIRDROP_MODULE_PROTOCOL_FEE_INDEX = 0;

    /* ============ State Variables ============ */

    mapping(ICKToken => AirdropSettings) public airdropSettings;
    // Mapping indicating if token is an allowed airdrop
    mapping(ICKToken => mapping(IERC20 => bool)) public isAirdrop;

    /* ============ Constructor ============ */

    constructor(IController _controller) public ModuleBase(_controller) {}

    /* ============ External Functions ============ */

    /**
     * Absorb passed tokens into respective positions. If airdropFee defined, send portion to feeRecipient and portion to
     * protocol feeRecipient address. Callable only by manager unless manager has set anyoneAbsorb to true.
     *
     * @param _ckToken                  Address of CKToken
     * @param _tokens                   Array of tokens to absorb
     */
    function batchAbsorb(ICKToken _ckToken, address[] memory _tokens)
        external
        nonReentrant
        onlyValidCaller(_ckToken)
        onlyValidAndInitializedCK(_ckToken)
    {
        _batchAbsorb(_ckToken, _tokens);
    }

    /**
     * Absorb specified token into position. If airdropFee defined, send portion to feeRecipient and portion to
     * protocol feeRecipient address. Callable only by manager unless manager has set anyoneAbsorb to true.
     *
     * @param _ckToken                  Address of CKToken
     * @param _token                    Address of token to absorb
     */
    function absorb(ICKToken _ckToken, IERC20 _token)
        external
        nonReentrant
        onlyValidCaller(_ckToken)
        onlyValidAndInitializedCK(_ckToken)
    {
        _absorb(_ckToken, _token);
    }

    /**
     * CK MANAGER ONLY. Adds new tokens to be added to positions when absorb is called.
     *
     * @param _ckToken                  Address of CKToken
     * @param _airdrop                  Component to add to airdrop list
     */
    function addAirdrop(ICKToken _ckToken, IERC20 _airdrop) external onlyManagerAndValidCK(_ckToken) {
        require(!isAirdropToken(_ckToken, _airdrop), "Token already added.");
        airdropSettings[_ckToken].airdrops.push(address(_airdrop));
        isAirdrop[_ckToken][_airdrop] = true;
        emit AirdropComponentAdded(_ckToken, _airdrop);
    }

    /**
     * CK MANAGER ONLY. Removes tokens from list to be absorbed.
     *
     * @param _ckToken                  Address of CKToken
     * @param _airdrop                  Component to remove from airdrop list
     */
    function removeAirdrop(ICKToken _ckToken, IERC20 _airdrop) external onlyManagerAndValidCK(_ckToken) {
        require(isAirdropToken(_ckToken, _airdrop), "Token not added.");
        airdropSettings[_ckToken].airdrops.removeStorage(address(_airdrop));
        isAirdrop[_ckToken][_airdrop] = false;
        emit AirdropComponentRemoved(_ckToken, _airdrop);
    }

    /**
     * CK MANAGER ONLY. Update whether manager allows other addresses to call absorb.
     *
     * @param _ckToken                  Address of CKToken
     */
    function updateAnyoneAbsorb(ICKToken _ckToken, bool _anyoneAbsorb) external onlyManagerAndValidCK(_ckToken) {
        airdropSettings[_ckToken].anyoneAbsorb = _anyoneAbsorb;
        emit AnyoneAbsorbUpdated(_ckToken, _anyoneAbsorb);
    }

    /**
     * CK MANAGER ONLY. Update address manager fees are sent to.
     *
     * @param _ckToken              Address of CKToken
     * @param _newFeeRecipient      Address of new fee recipient
     */
    function updateFeeRecipient(
        ICKToken _ckToken,
        address _newFeeRecipient
    )
        external
        onlyManagerAndValidCK(_ckToken)
    {
        require(_newFeeRecipient != address(0), "Passed address must be non-zero");
        airdropSettings[_ckToken].feeRecipient = _newFeeRecipient;
        emit FeeRecipientUpdated(_ckToken, _newFeeRecipient);
    }

    /**
     * CK MANAGER ONLY. Update airdrop fee percentage.
     *
     * @param _ckToken          Address of CKToken
     * @param _newFee           Percentage, in preciseUnits, of new airdrop fee (1e16 = 1%)
     */
    function updateAirdropFee(
        ICKToken _ckToken,
        uint256 _newFee
    )
        external
        onlyCKManager(_ckToken, msg.sender)
        onlyValidAndInitializedCK(_ckToken)
    {
        require(_newFee <=  PreciseUnitMath.preciseUnit(), "Airdrop fee can't exceed 100%");

        // Absorb all outstanding tokens before fee is updated
        _batchAbsorb(_ckToken, airdropSettings[_ckToken].airdrops);

        airdropSettings[_ckToken].airdropFee = _newFee;
        emit AirdropFeeUpdated(_ckToken, _newFee);
    }

    /**
     * CK MANAGER ONLY. Initialize module with CKToken and set initial airdrop tokens as well as specify
     * whether anyone can call absorb.
     *
     * @param _ckToken                  Address of CKToken
     * @param _airdropSettings          Struct of airdrop setting for Set including accepted airdrops, feeRecipient,
     *                                  airdropFee, and indicating if anyone can call an absorb
     */
    function initialize(
        ICKToken _ckToken,
        AirdropSettings memory _airdropSettings
    )
        external
        onlyCKManager(_ckToken, msg.sender)
        onlyValidAndPendingCK(_ckToken)
    {
        require(_airdropSettings.airdropFee <= PreciseUnitMath.preciseUnit(), "Fee must be <= 100%.");
        require(_airdropSettings.feeRecipient != address(0), "Zero fee address passed");
        if (_airdropSettings.airdrops.length > 0) {
            require(!_airdropSettings.airdrops.hasDuplicate(), "Duplicate airdrop token passed");
        }

        airdropSettings[_ckToken] = _airdropSettings;

        for (uint256 i = 0; i < _airdropSettings.airdrops.length; i++) {
            isAirdrop[_ckToken][IERC20(_airdropSettings.airdrops[i])] = true;
        }

        _ckToken.initializeModule();
    }

    /**
     * Removes this module from the CKToken, via call by the CKToken. Token's airdrop settings are deleted.
     * Airdrops are not absorbed.
     */
    function removeModule() external override {
        address[] memory airdrops = airdropSettings[ICKToken(msg.sender)].airdrops;

        for (uint256 i =0; i < airdrops.length; i++) {
            isAirdrop[ICKToken(msg.sender)][IERC20(airdrops[i])] = false;
        }

        delete airdropSettings[ICKToken(msg.sender)];
    }

    /**
     * Get list of tokens approved to collect airdrops for the CKToken.
     *
     * @param _ckToken              Address of CKToken
     * @return                      Array of tokens approved for airdrops
     */
    function getAirdrops(ICKToken _ckToken) external view returns (address[] memory) {
        return airdropSettings[_ckToken].airdrops;
    }

    /**
     * Get boolean indicating if token is approved for airdrops.
     *
     * @param _ckToken              Address of CKToken
     * @return                      Boolean indicating approval for airdrops
     */
    function isAirdropToken(ICKToken _ckToken, IERC20 _token) public view returns (bool) {
        return isAirdrop[_ckToken][_token];
    }

    /* ============ Internal Functions ============ */

    /**
     * Check token approved for airdrops then handle airdropped postion.
     */
    function _absorb(ICKToken _ckToken, IERC20 _token) internal {
        require(isAirdropToken(_ckToken, _token), "Must be approved token.");

        _handleAirdropPosition(_ckToken, _token);
    }

    /**
     * Loop through array of tokens and handle airdropped positions.
     */
    function _batchAbsorb(ICKToken _ckToken, address[] memory _tokens) internal {
        for (uint256 i = 0; i < _tokens.length; i++) {
            _absorb(_ckToken, IERC20(_tokens[i]));
        }
    }

    /**
     * Calculate amount of tokens airdropped since last absorption, then distribute fees and update position.
     *
     * @param _ckToken                  Address of CKToken
     * @param _token                    Address of airdropped token
     */
    function _handleAirdropPosition(ICKToken _ckToken, IERC20 _token) internal {
        uint256 preFeeTokenBalance = _token.balanceOf(address(_ckToken));
        uint256 amountAirdropped = preFeeTokenBalance.sub(_ckToken.getDefaultTrackedBalance(address(_token)));

        if (amountAirdropped > 0) {
            (uint256 managerTake, uint256 protocolTake, uint256 totalFees) = _handleFees(_ckToken, _token, amountAirdropped);
            
            uint256 newUnit = _getPostAirdropUnit(_ckToken, preFeeTokenBalance, totalFees);

            _ckToken.editDefaultPosition(address(_token), newUnit);

            emit ComponentAbsorbed(_ckToken, _token, amountAirdropped, managerTake, protocolTake);
        }
    }

    /**
     * Calculate fee total and distribute between feeRecipient defined on module and the protocol feeRecipient.
     *
     * @param _ckToken                  Address of CKToken
     * @param _component                Address of airdropped component
     * @param _amountAirdropped         Amount of tokens airdropped to the CKToken
     * @return netManagerTake           Amount of airdropped tokens set aside for manager fees net of protocol fees
     * @return protocolTake             Amount of airdropped tokens set aside for protocol fees (taken from manager fees)
     * @return totalFees                Total fees paid
     */
    function _handleFees(
        ICKToken _ckToken,
        IERC20 _component,
        uint256 _amountAirdropped
    )
        internal
        returns (uint256 netManagerTake, uint256 protocolTake, uint256 totalFees)
    {
        uint256 airdropFee = airdropSettings[_ckToken].airdropFee;

        if (airdropFee > 0) {
            totalFees = _amountAirdropped.preciseMul(airdropFee);
            
            protocolTake = getModuleFee(AIRDROP_MODULE_PROTOCOL_FEE_INDEX, totalFees);
            netManagerTake = totalFees.sub(protocolTake);

            _ckToken.strictInvokeTransfer(address(_component), airdropSettings[_ckToken].feeRecipient, netManagerTake);
            
            payProtocolFeeFromCKToken(_ckToken, address(_component), protocolTake);

            return (netManagerTake, protocolTake, totalFees);
        } else {
            return (0, 0, 0);
        }
    }

    /**
     * Retrieve new unit, which is the current balance less fees paid divided by total supply
     */ 
    function _getPostAirdropUnit(
        ICKToken _ckToken,
        uint256 _totalComponentBalance,
        uint256 _totalFeesPaid

    )
        internal
        view
        returns(uint256)
    {
        uint256 totalSupply = _ckToken.totalSupply();
        return totalSupply.getDefaultPositionUnit(_totalComponentBalance.sub(_totalFeesPaid));
    }

    /**
     * If absorption is confined to the manager, manager must be caller
     */ 
    function _isValidCaller(ICKToken _ckToken) internal view returns(bool) {
        return airdropSettings[_ckToken].anyoneAbsorb || isCKManager(_ckToken, msg.sender);       
    }
}