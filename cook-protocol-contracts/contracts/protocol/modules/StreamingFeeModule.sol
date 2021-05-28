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
import { SafeCast } from "@openzeppelin/contracts/utils/SafeCast.sol";
import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";
import { SignedSafeMath } from "@openzeppelin/contracts/math/SignedSafeMath.sol";

import { IController } from "../../interfaces/IController.sol";
import { ICKToken } from "../../interfaces/ICKToken.sol";
import { ModuleBase } from "../lib/ModuleBase.sol";
import { PreciseUnitMath } from "../../lib/PreciseUnitMath.sol";


/**
 * @title StreamingFeeModule
 * @author Cook Finance
 *
 * Smart contract that accrues streaming fees for CK managers. Streaming fees are denominated as percent
 * per year and realized as CK inflation rewarded to the manager.
 */
contract StreamingFeeModule is ModuleBase, ReentrancyGuard {
    using SafeMath for uint256;
    using PreciseUnitMath for uint256;
    using SafeCast for uint256;

    using SignedSafeMath for int256;
    using PreciseUnitMath for int256;
    using SafeCast for int256;


    /* ============ Structs ============ */

    struct FeeState {
        address feeRecipient;                   // Address to accrue fees to
        uint256 maxStreamingFeePercentage;      // Max streaming fee maanager commits to using (1% = 1e16, 100% = 1e18)
        uint256 streamingFeePercentage;         // Percent of CK accruing to manager annually (1% = 1e16, 100% = 1e18)
        uint256 lastStreamingFeeTimestamp;      // Timestamp last streaming fee was accrued
    }

    /* ============ Events ============ */

    event FeeActualized(address indexed _ckToken, uint256 _managerFee, uint256 _protocolFee);
    event StreamingFeeUpdated(address indexed _ckToken, uint256 _newStreamingFee);
    event FeeRecipientUpdated(address indexed _ckToken, address _newFeeRecipient);

    /* ============ Constants ============ */

    uint256 private constant ONE_YEAR_IN_SECONDS = 365.25 days;
    uint256 private constant PROTOCOL_STREAMING_FEE_INDEX = 0;

    /* ============ State Variables ============ */

    mapping(ICKToken => FeeState) public feeStates;

    /* ============ Constructor ============ */

    constructor(IController _controller) public ModuleBase(_controller) {}

    /* ============ External Functions ============ */

    /*
     * Calculates total inflation percentage then mints new CKs to the fee recipient. Position units are
     * then adjusted down (in magnitude) in order to ensure full collateralization. Callable by anyone.
     *
     * @param _ckToken       Address of CKToken
     */
    function accrueFee(ICKToken _ckToken) public nonReentrant onlyValidAndInitializedCK(_ckToken) {
        uint256 managerFee;
        uint256 protocolFee;

        if (_streamingFeePercentage(_ckToken) > 0) {
            uint256 inflationFeePercentage = _calculateStreamingFee(_ckToken);

            // Calculate incentiveFee inflation
            uint256 feeQuantity = _calculateStreamingFeeInflation(_ckToken, inflationFeePercentage);

            // Mint new CKs to manager and protocol
            (
                managerFee,
                protocolFee
            ) = _mintManagerAndProtocolFee(_ckToken, feeQuantity);

            _editPositionMultiplier(_ckToken, inflationFeePercentage);
        }

        feeStates[_ckToken].lastStreamingFeeTimestamp = block.timestamp;

        emit FeeActualized(address(_ckToken), managerFee, protocolFee);
    }

    /**
     * CK MANAGER ONLY. Initialize module with CKToken and set the fee state for the CKToken. Passed
     * _settings will have lastStreamingFeeTimestamp over-written.
     *
     * @param _ckToken                 Address of CKToken
     * @param _settings                 FeeState struct defining fee parameters
     */
    function initialize(
        ICKToken _ckToken,
        FeeState memory _settings
    )
        external
        onlyCKManager(_ckToken, msg.sender)
        onlyValidAndPendingCK(_ckToken)
    {
        require(_settings.feeRecipient != address(0), "Fee Recipient must be non-zero address.");
        require(_settings.maxStreamingFeePercentage < PreciseUnitMath.preciseUnit(), "Max fee must be < 100%.");
        require(_settings.streamingFeePercentage <= _settings.maxStreamingFeePercentage, "Fee must be <= max.");

        _settings.lastStreamingFeeTimestamp = block.timestamp;

        feeStates[_ckToken] = _settings;
        _ckToken.initializeModule();
    }

    /**
     * Removes this module from the CKToken, via call by the CKToken. Manager's feeState is deleted. Fees
     * are not accrued in case reason for removing module is related to fee accrual.
     */
    function removeModule() external override {
        delete feeStates[ICKToken(msg.sender)];
    }

    /*
     * Set new streaming fee. Fees accrue at current rate then new rate is set.
     * Fees are accrued to prevent the manager from unfairly accruing a larger percentage.
     *
     * @param _ckToken       Address of CKToken
     * @param _newFee         New streaming fee 18 decimal precision
     */
    function updateStreamingFee(
        ICKToken _ckToken,
        uint256 _newFee
    )
        external
        onlyCKManager(_ckToken, msg.sender)
        onlyValidAndInitializedCK(_ckToken)
    {
        require(_newFee < _maxStreamingFeePercentage(_ckToken), "Fee must be less than max");
        accrueFee(_ckToken);

        feeStates[_ckToken].streamingFeePercentage = _newFee;

        emit StreamingFeeUpdated(address(_ckToken), _newFee);
    }

    /*
     * Set new fee recipient.
     *
     * @param _ckToken             Address of CKToken
     * @param _newFeeRecipient      New fee recipient
     */
    function updateFeeRecipient(ICKToken _ckToken, address _newFeeRecipient)
        external
        onlyCKManager(_ckToken, msg.sender)
        onlyValidAndInitializedCK(_ckToken)
    {
        require(_newFeeRecipient != address(0), "Fee Recipient must be non-zero address.");

        feeStates[_ckToken].feeRecipient = _newFeeRecipient;

        emit FeeRecipientUpdated(address(_ckToken), _newFeeRecipient);
    }

    /*
     * Calculates total inflation percentage in order to accrue fees to manager.
     *
     * @param _ckToken       Address of CKToken
     * @return  uint256       Percent inflation of supply
     */
    function getFee(ICKToken _ckToken) external view returns (uint256) {
        return _calculateStreamingFee(_ckToken);
    }

    /* ============ Internal Functions ============ */

    /**
     * Calculates streaming fee by multiplying streamingFeePercentage by the elapsed amount of time since the last fee
     * was collected divided by one year in seconds, since the fee is a yearly fee.
     *
     * @param  _ckToken          Address of CK to have feeState updated
     * @return uint256            Streaming fee denominated in percentage of totalSupply
     */
    function _calculateStreamingFee(ICKToken _ckToken) internal view returns(uint256) {
        uint256 timeSinceLastFee = block.timestamp.sub(_lastStreamingFeeTimestamp(_ckToken));

        // Streaming fee is streaming fee times years since last fee
        return timeSinceLastFee.mul(_streamingFeePercentage(_ckToken)).div(ONE_YEAR_IN_SECONDS);
    }

    /**
     * Returns the new incentive fee denominated in the number of CKTokens to mint. The calculation for the fee involves
     * implying mint quantity so that the feeRecipient owns the fee percentage of the entire supply of the CK.
     *
     * The formula to solve for fee is:
     * (feeQuantity / feeQuantity) + totalSupply = fee / scaleFactor
     *
     * The simplified formula utilized below is:
     * feeQuantity = fee * totalSupply / (scaleFactor - fee)
     *
     * @param   _ckToken               CKToken instance
     * @param   _feePercentage          Fee levied to feeRecipient
     * @return  uint256                 New RebalancingCK issue quantity
     */
    function _calculateStreamingFeeInflation(
        ICKToken _ckToken,
        uint256 _feePercentage
    )
        internal
        view
        returns (uint256)
    {
        uint256 totalSupply = _ckToken.totalSupply();

        // fee * totalSupply
        uint256 a = _feePercentage.mul(totalSupply);

        // ScaleFactor (10e18) - fee
        uint256 b = PreciseUnitMath.preciseUnit().sub(_feePercentage);

        return a.div(b);
    }

    /**
     * Mints CKs to both the manager and the protocol. Protocol takes a percentage fee of the total amount of CKs
     * minted to manager.
     *
     * @param   _ckToken               CKToken instance
     * @param   _feeQuantity            Amount of CKs to be minted as fees
     * @return  uint256                 Amount of CKs accrued to manager as fee
     * @return  uint256                 Amount of CKs accrued to protocol as fee
     */
    function _mintManagerAndProtocolFee(ICKToken _ckToken, uint256 _feeQuantity) internal returns (uint256, uint256) {
        address protocolFeeRecipient = controller.feeRecipient();
        uint256 protocolFee = controller.getModuleFee(address(this), PROTOCOL_STREAMING_FEE_INDEX);

        uint256 protocolFeeAmount = _feeQuantity.preciseMul(protocolFee);
        uint256 managerFeeAmount = _feeQuantity.sub(protocolFeeAmount);

        _ckToken.mint(_feeRecipient(_ckToken), managerFeeAmount);

        if (protocolFeeAmount > 0) {
            _ckToken.mint(protocolFeeRecipient, protocolFeeAmount);
        }

        return (managerFeeAmount, protocolFeeAmount);
    }

    /**
     * Calculates new position multiplier according to following formula:
     *
     * newMultiplier = oldMultiplier * (1-inflationFee)
     *
     * This reduces position sizes to offset increase in supply due to fee collection.
     *
     * @param   _ckToken               CKToken instance
     * @param   _inflationFee           Fee inflation rate
     */
    function _editPositionMultiplier(ICKToken _ckToken, uint256 _inflationFee) internal {
        int256 currentMultipler = _ckToken.positionMultiplier();
        int256 newMultiplier = currentMultipler.preciseMul(PreciseUnitMath.preciseUnit().sub(_inflationFee).toInt256());

        _ckToken.editPositionMultiplier(newMultiplier);
    }

    function _feeRecipient(ICKToken _ck) internal view returns (address) {
        return feeStates[_ck].feeRecipient;
    }

    function _lastStreamingFeeTimestamp(ICKToken _ck) internal view returns (uint256) {
        return feeStates[_ck].lastStreamingFeeTimestamp;
    }

    function _maxStreamingFeePercentage(ICKToken _ck) internal view returns (uint256) {
        return feeStates[_ck].maxStreamingFeePercentage;
    }

    function _streamingFeePercentage(ICKToken _ck) internal view returns (uint256) {
        return feeStates[_ck].streamingFeePercentage;
    }
}