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

pragma solidity ^0.6.10;
pragma experimental "ABIEncoderV2";

import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/SafeCast.sol";

import { IController } from "../../interfaces/IController.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IExchangeAdapter } from "../../interfaces/IExchangeAdapter.sol";
import { IIntegrationRegistry } from "../../interfaces/IIntegrationRegistry.sol";
import { Invoke } from "../lib/Invoke.sol";
import { ICKToken } from "../../interfaces/ICKToken.sol";
import { ModuleBase } from "../lib/ModuleBase.sol";
import { Position } from "../lib/Position.sol";
import { PreciseUnitMath } from "../../lib/PreciseUnitMath.sol";

/**
 * @title TradeModule
 * @author Cook Finance
 *
 * Module that enables CKTokens to perform atomic trades using Decentralized Exchanges
 * such as Uniswap. Integrations mappings are stored on the IntegrationRegistry contract.
 */
contract TradeModule is ModuleBase, ReentrancyGuard {
    using SafeCast for int256;
    using SafeMath for uint256;

    using Invoke for ICKToken;
    using Position for ICKToken;
    using PreciseUnitMath for uint256;

    /* ============ Struct ============ */

    struct TradeInfo {
        ICKToken ckToken;                             // Instance of CKToken
        IExchangeAdapter exchangeAdapter;               // Instance of exchange adapter contract
        address sendToken;                              // Address of token being sold
        address receiveToken;                           // Address of token being bought
        uint256 ckTotalSupply;                         // Total supply of CKToken in Precise Units (10^18)
        uint256 totalSendQuantity;                      // Total quantity of sold token (position unit x total supply)
        uint256 totalMinReceiveQuantity;                // Total minimum quantity of token to receive back
        uint256 preTradeSendTokenBalance;               // Total initial balance of token being sold
        uint256 preTradeReceiveTokenBalance;            // Total initial balance of token being bought
    }

    /* ============ Events ============ */

    event ComponentExchanged(
        ICKToken indexed _ckToken,
        address indexed _sendToken,
        address indexed _receiveToken,
        IExchangeAdapter _exchangeAdapter,
        uint256 _totalSendAmount,
        uint256 _totalReceiveAmount,
        uint256 _protocolFee
    );

    /* ============ Constants ============ */

    // 0 index stores the fee % charged in the trade function
    uint256 constant internal TRADE_MODULE_PROTOCOL_FEE_INDEX = 0;

    /* ============ Constructor ============ */

    constructor(IController _controller) public ModuleBase(_controller) {}

    /* ============ External Functions ============ */

    /**
     * Initializes this module to the CKToken. Only callable by the CKToken's manager.
     *
     * @param _ckToken                 Instance of the CKToken to initialize
     */
    function initialize(
        ICKToken _ckToken
    )
        external
        onlyValidAndPendingCK(_ckToken)
        onlyCKManager(_ckToken, msg.sender)
    {
        _ckToken.initializeModule();
    }

    /**
     * Executes a trade on a supported DEX. Only callable by the CKToken's manager.
     * @dev Although the CKToken units are passed in for the send and receive quantities, the total quantity
     * sent and received is the quantity of CKToken units multiplied by the CKToken totalSupply.
     *
     * @param _ckToken             Instance of the CKToken to trade
     * @param _exchangeName         Human readable name of the exchange in the integrations registry
     * @param _sendToken            Address of the token to be sent to the exchange
     * @param _sendQuantity         Units of token in CKToken sent to the exchange
     * @param _receiveToken         Address of the token that will be received from the exchange
     * @param _minReceiveQuantity   Min units of token in CKToken to be received from the exchange
     * @param _data                 Arbitrary bytes to be used to construct trade call data
     */
    function trade(
        ICKToken _ckToken,
        string memory _exchangeName,
        address _sendToken,
        uint256 _sendQuantity,
        address _receiveToken,
        uint256 _minReceiveQuantity,
        bytes memory _data
    )
        external
        nonReentrant
        onlyManagerAndValidCK(_ckToken)
    {
        TradeInfo memory tradeInfo = _createTradeInfo(
            _ckToken,
            _exchangeName,
            _sendToken,
            _receiveToken,
            _sendQuantity,
            _minReceiveQuantity
        );

        _validatePreTradeData(tradeInfo, _sendQuantity);

        _executeTrade(tradeInfo, _data);

        uint256 exchangedQuantity = _validatePostTrade(tradeInfo);

        uint256 protocolFee = _accrueProtocolFee(tradeInfo, exchangedQuantity);

        (
            uint256 netSendAmount,
            uint256 netReceiveAmount
        ) = _updateCKTokenPositions(tradeInfo);

        emit ComponentExchanged(
            _ckToken,
            _sendToken,
            _receiveToken,
            tradeInfo.exchangeAdapter,
            netSendAmount,
            netReceiveAmount,
            protocolFee
        );
    }

    /**
     * Removes this module from the CKToken, via call by the CKToken. Left with empty logic
     * here because there are no check needed to verify removal.
     */
    function removeModule() external override {}

    /* ============ Internal Functions ============ */

    /**
     * Create and return TradeInfo struct
     *
     * @param _ckToken             Instance of the CKToken to trade
     * @param _exchangeName         Human readable name of the exchange in the integrations registry
     * @param _sendToken            Address of the token to be sent to the exchange
     * @param _receiveToken         Address of the token that will be received from the exchange
     * @param _sendQuantity         Units of token in CKToken sent to the exchange
     * @param _minReceiveQuantity   Min units of token in CKToken to be received from the exchange
     *
     * return TradeInfo             Struct containing data for trade
     */
    function _createTradeInfo(
        ICKToken _ckToken,
        string memory _exchangeName,
        address _sendToken,
        address _receiveToken,
        uint256 _sendQuantity,
        uint256 _minReceiveQuantity
    )
        internal
        view
        returns (TradeInfo memory)
    {
        TradeInfo memory tradeInfo;

        tradeInfo.ckToken = _ckToken;

        tradeInfo.exchangeAdapter = IExchangeAdapter(getAndValidateAdapter(_exchangeName));

        tradeInfo.sendToken = _sendToken;
        tradeInfo.receiveToken = _receiveToken;

        tradeInfo.ckTotalSupply = _ckToken.totalSupply();

        tradeInfo.totalSendQuantity = Position.getDefaultTotalNotional(tradeInfo.ckTotalSupply, _sendQuantity);

        tradeInfo.totalMinReceiveQuantity = Position.getDefaultTotalNotional(tradeInfo.ckTotalSupply, _minReceiveQuantity);

        tradeInfo.preTradeSendTokenBalance = IERC20(_sendToken).balanceOf(address(_ckToken));
        tradeInfo.preTradeReceiveTokenBalance = IERC20(_receiveToken).balanceOf(address(_ckToken));

        return tradeInfo;
    }

    /**
     * Validate pre trade data. Check exchange is valid, token quantity is valid.
     *
     * @param _tradeInfo            Struct containing trade information used in internal functions
     * @param _sendQuantity         Units of token in CKToken sent to the exchange
     */
    function _validatePreTradeData(TradeInfo memory _tradeInfo, uint256 _sendQuantity) internal view {
        require(_tradeInfo.totalSendQuantity > 0, "Token to sell must be nonzero");

        require(
            _tradeInfo.ckToken.hasSufficientDefaultUnits(_tradeInfo.sendToken, _sendQuantity),
            "Unit cant be greater than existing"
        );
    }

    /**
     * Invoke approve for send token, get method data and invoke trade in the context of the CKToken.
     *
     * @param _tradeInfo            Struct containing trade information used in internal functions
     * @param _data                 Arbitrary bytes to be used to construct trade call data
     */
    function _executeTrade(
        TradeInfo memory _tradeInfo,
        bytes memory _data
    )
        internal
    {
        // Get spender address from exchange adapter and invoke approve for exact amount on CKToken
        _tradeInfo.ckToken.invokeApprove(
            _tradeInfo.sendToken,
            _tradeInfo.exchangeAdapter.getSpender(),
            _tradeInfo.totalSendQuantity
        );

        (
            address targetExchange,
            uint256 callValue,
            bytes memory methodData
        ) = _tradeInfo.exchangeAdapter.getTradeCalldata(
            _tradeInfo.sendToken,
            _tradeInfo.receiveToken,
            address(_tradeInfo.ckToken),
            _tradeInfo.totalSendQuantity,
            _tradeInfo.totalMinReceiveQuantity,
            _data
        );

        _tradeInfo.ckToken.invoke(targetExchange, callValue, methodData);
    }

    /**
     * Validate post trade data.
     *
     * @param _tradeInfo                Struct containing trade information used in internal functions
     * @return uint256                  Total quantity of receive token that was exchanged
     */
    function _validatePostTrade(TradeInfo memory _tradeInfo) internal view returns (uint256) {
        uint256 exchangedQuantity = IERC20(_tradeInfo.receiveToken)
            .balanceOf(address(_tradeInfo.ckToken))
            .sub(_tradeInfo.preTradeReceiveTokenBalance);

        require(
            exchangedQuantity >= _tradeInfo.totalMinReceiveQuantity,
            "Slippage greater than allowed"
        );

        return exchangedQuantity;
    }

    /**
     * Retrieve fee from controller and calculate total protocol fee and send from CKToken to protocol recipient
     *
     * @param _tradeInfo                Struct containing trade information used in internal functions
     * @return uint256                  Amount of receive token taken as protocol fee
     */
    function _accrueProtocolFee(TradeInfo memory _tradeInfo, uint256 _exchangedQuantity) internal returns (uint256) {
        uint256 protocolFeeTotal = getModuleFee(TRADE_MODULE_PROTOCOL_FEE_INDEX, _exchangedQuantity);
        
        payProtocolFeeFromCKToken(_tradeInfo.ckToken, _tradeInfo.receiveToken, protocolFeeTotal);
        
        return protocolFeeTotal;
    }

    /**
     * Update CKToken positions
     *
     * @param _tradeInfo                Struct containing trade information used in internal functions
     * @return uint256                  Amount of sendTokens used in the trade
     * @return uint256                  Amount of receiveTokens received in the trade (net of fees)
     */
    function _updateCKTokenPositions(TradeInfo memory _tradeInfo) internal returns (uint256, uint256) {
        (uint256 currentSendTokenBalance,,) = _tradeInfo.ckToken.calculateAndEditDefaultPosition(
            _tradeInfo.sendToken,
            _tradeInfo.ckTotalSupply,
            _tradeInfo.preTradeSendTokenBalance
        );

        (uint256 currentReceiveTokenBalance,,) = _tradeInfo.ckToken.calculateAndEditDefaultPosition(
            _tradeInfo.receiveToken,
            _tradeInfo.ckTotalSupply,
            _tradeInfo.preTradeReceiveTokenBalance
        );

        return (
            _tradeInfo.preTradeSendTokenBalance.sub(currentSendTokenBalance),
            currentReceiveTokenBalance.sub(_tradeInfo.preTradeReceiveTokenBalance)
        );
    }
}