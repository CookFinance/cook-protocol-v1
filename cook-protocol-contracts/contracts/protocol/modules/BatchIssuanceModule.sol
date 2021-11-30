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

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Math } from "@openzeppelin/contracts/math/Math.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/SafeCast.sol";
import { Address } from "@openzeppelin/contracts/utils/Address.sol";
import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";

import { IController } from "../../interfaces/IController.sol";
import { IBasicIssuanceModule } from "../../interfaces/IBasicIssuanceModule.sol";
import { IIndexExchangeAdapter } from "../../interfaces/IIndexExchangeAdapter.sol";
import { IPriceOracle } from "../../interfaces/IPriceOracle.sol";
import { ICKToken } from "../../interfaces/ICKToken.sol";
import { IWETH } from "../../interfaces/external/IWETH.sol";
import { ModuleBase } from "../lib/ModuleBase.sol";
import { PreciseUnitMath } from "../../lib/PreciseUnitMath.sol";

/**
 * @title BatchIssuanceModule
 * @author Cook Finance
 *
 * Module that enables batch issuance and redemption functionality on a CKToken, for the purpose of gas saving.
 * This is a module that is required to bring the totalSupply of a CK above 0.
 */
contract BatchIssuanceModule is ModuleBase, ReentrancyGuard {
    using PreciseUnitMath for uint256;
    using SafeMath for uint256;
    using Math for uint256;
    using SafeCast for int256;
    using SafeERC20 for IWETH;
    using SafeERC20 for IERC20;
    using Address for address;

    /* ============ Events ============ */

    event CKTokenBatchIssued(
        ICKToken indexed _ckToken,
        uint256 _inputUsed,
        uint256 _outputCK,
        uint256 _roundNumber
    );
    event ManagerFeeEdited(ICKToken indexed _ckToken, uint256 _newManagerFee, uint256 _index);
    event FeeRecipientEdited(ICKToken indexed _ckToken, address _feeRecipient);
    event AssetExchangeUpdated(ICKToken indexed _ckToken, address _component, string _newExchangeName);
    event Deposit(ICKToken indexed _ckToken, address _to, uint256 _amount, uint256 _round);
    event WithdrawCKToken(
        ICKToken indexed _ckToken,
        address indexed _from,
        address indexed _to,
        uint256 _amount
    );

    /* ============ Structs ============ */

    struct BatchIssuanceSetting {
        address feeRecipient;                       // Manager fee recipient
        uint256[2] managerFees;                     // Manager fees. 0 index is issue and 1 index is redeem fee (0.01% = 1e14, 1% = 1e16)
        uint256 maxManagerFee;                      // Maximum fee manager is allowed to set for issue and redeem
        uint256 minCKTokenSupply;                   // Minimum CKToken supply required for issuance and redemption 
                                                    // to prevent dramatic inflationary changes to the CKToken's position multiplier
    }

    struct ActionInfo {
        uint256 preFeeReserveQuantity;              // Reserve value before fees; During issuance, represents raw quantity
        uint256 totalFeePercentage;                 // Total protocol fees (direct + manager revenue share)
        uint256 protocolFees;                       // Total protocol fees (direct + manager revenue share)
        uint256 managerFee;                         // Total manager fee paid in reserve asset
        uint256 netFlowQuantity;                    // When issuing, quantity of reserve asset sent to CKToken
        uint256 ckTokenQuantity;                    // When issuing, quantity of CKTokens minted to mintee
        uint256 previousCKTokenSupply;              // CKToken supply prior to issue/redeem action
        uint256 newCKTokenSupply;                   // CKToken supply after issue/redeem action
    }

    struct TradeExecutionParams {
        string exchangeName;                        // Exchange adapter name
        bytes exchangeData;                         // Arbitrary data that can be used to encode exchange specific 
                                                    // settings (fee tier) or features (multi-hop)
    }

    struct TradeInfo {
        IIndexExchangeAdapter exchangeAdapter;      // Instance of Exchange Adapter
        address receiveToken;                       // Address of token being bought
        uint256 sendQuantityMax;                    // Max amount of tokens to sent to the exchange
        uint256 receiveQuantity;                    // Amount of tokens receiving
        bytes exchangeData;                         // Arbitrary data for executing trade on given exchange
    }

    struct RoundInfo {
        uint256 totalEthDeposited;                  // total deposited ETH amount in a round
        uint256 totalCkTokenIssued;                 // total issed ckToken in a round
    }

    /* ============ Constants ============ */

    // 0 index stores the manager fee in managerFees array, percentage charged on issue (denominated in reserve asset)
    uint256 constant internal MANAGER_ISSUE_FEE_INDEX = 0;
    // 0 index stores the manager revenue share protocol fee % on the controller, charged in the issuance function
    uint256 constant internal PROTOCOL_ISSUE_MANAGER_REVENUE_SHARE_FEE_INDEX = 0;
    // 2 index stores the direct protocol fee % on the controller, charged in the issuance function
    uint256 constant internal PROTOCOL_ISSUE_DIRECT_FEE_INDEX = 2;

    /* ============ State Variables ============ */

    IWETH public immutable weth;                        // Wrapped ETH address
    IBasicIssuanceModule public basicIssuanceModule;    // Basic Issuance Module
    
    // Mapping of CKToken to Batch issuance setting
    mapping(ICKToken => BatchIssuanceSetting) private batchIssuanceSettings;
    // Mapping of CKToken to (component to execution params)
    mapping(ICKToken => mapping(IERC20 => TradeExecutionParams)) private tradeExecutionInfo;
    // Mapping of CKToken to onoing batch issue round for deposit
    mapping(ICKToken => uint256) public roundNumbers;
    // Mapping of CKToken to round info
    mapping(ICKToken => mapping(uint256 => RoundInfo)) public roundInfos;
    // Mapping of CKToken to user deposit in a round, key is hashed by keccak256(user_address, round number)
    mapping(ICKToken => mapping(bytes32 => uint256)) public userDeposits;

    /* ============ Constructor ============ */

    /**
     * Set state controller state variable
     *
     * @param _controller           Address of controller contract
     * @param _weth                 Address of WETH
     * @param _basicIssuanceModule  Instance of the basic issuance module
     */
    constructor(
        IController _controller,
        IWETH _weth,
        IBasicIssuanceModule _basicIssuanceModule
    ) public ModuleBase(_controller) {
        weth = _weth;
        // set basic issuance module
        basicIssuanceModule = _basicIssuanceModule;
    }

    /* ============ External Functions ============ */

    /**
     * Initializes this module to the CKToken with issuance settings and round input cap(limit)
     *
     * @param _ckToken              Instance of the CKToken to issue
     * @param _batchIssuanceSetting BatchIssuanceSetting struct define parameters
     */
    function initialize(
        ICKToken _ckToken,
        BatchIssuanceSetting memory _batchIssuanceSetting
    )
        external
        onlyCKManager(_ckToken, msg.sender)
        onlyValidAndPendingCK(_ckToken)
    {
        require(_ckToken.isInitializedModule(address(basicIssuanceModule)), "BasicIssuanceModule must be initialized");
        require(_batchIssuanceSetting.maxManagerFee < PreciseUnitMath.preciseUnit(), "Max manager fee must be less than 100%");
        require(_batchIssuanceSetting.managerFees[0] <= _batchIssuanceSetting.maxManagerFee, "Manager issue fee must be less than max");
        require(_batchIssuanceSetting.managerFees[1] <= _batchIssuanceSetting.maxManagerFee, "Manager redeem fee must be less than max");
        require(_batchIssuanceSetting.feeRecipient != address(0), "Fee Recipient must be non-zero address.");
        require(_batchIssuanceSetting.minCKTokenSupply > 0, "Min CKToken supply must be greater than 0");

        // assgin the first round
        roundNumbers[_ckToken] = 0;

        // set batch issuance setting
        batchIssuanceSettings[_ckToken] = _batchIssuanceSetting;

        // initialize module for the CKToken
        _ckToken.initializeModule();
    }

    /**
     * CK MANAGER ONLY. Edit manager fee
     *
     * @param _ckToken                      Instance of the CKToken
     * @param _managerFeePercentage         Manager fee percentage in 10e16 (e.g. 10e16 = 1%)
     * @param _managerFeeIndex              Manager fee index. 0 index is issue fee, 1 index is redeem fee
     */
    function editManagerFee(
        ICKToken _ckToken,
        uint256 _managerFeePercentage,
        uint256 _managerFeeIndex
    )
        external
        onlyManagerAndValidCK(_ckToken)
    {
        require(_managerFeePercentage <= batchIssuanceSettings[_ckToken].maxManagerFee, "Manager fee must be less than maximum allowed");
        
        batchIssuanceSettings[_ckToken].managerFees[_managerFeeIndex] = _managerFeePercentage;

        emit ManagerFeeEdited(_ckToken, _managerFeePercentage, _managerFeeIndex);
    }

    /**
     * CK MANAGER ONLY. Edit the manager fee recipient
     *
     * @param _ckToken                      Instance of the CKToken
     * @param _managerFeeRecipient          Manager fee recipient
     */
    function editFeeRecipient(
        ICKToken _ckToken,
        address _managerFeeRecipient
    ) external onlyManagerAndValidCK(_ckToken) {
        require(_managerFeeRecipient != address(0), "Fee recipient must not be 0 address");
        
        batchIssuanceSettings[_ckToken].feeRecipient = _managerFeeRecipient;

        emit FeeRecipientEdited(_ckToken, _managerFeeRecipient);
    }

    /**
     * CK MANAGER ONLY: Set exchanges for underlying components of the CKToken. Can be called at anytime.
     *
     * @param _ckToken              Instance of the CKToken
     * @param _components           Array of components
     * @param _exchangeNames        Array of exchange names mapping to correct component
     */
    function setExchanges(
        ICKToken _ckToken,
        address[] memory _components,
        string[] memory _exchangeNames
    )
        external
        onlyManagerAndValidCK(_ckToken)
    {
        _components.validatePairsWithArray(_exchangeNames);

        for (uint256 i = 0; i < _components.length; i++) {
            if (_components[i] != address(weth)) {

                require(
                    controller.getIntegrationRegistry().isValidIntegration(address(this), _exchangeNames[i]),
                    "Unrecognized exchange name"
                );

                tradeExecutionInfo[_ckToken][IERC20(_components[i])].exchangeName = _exchangeNames[i];
                emit AssetExchangeUpdated(_ckToken, _components[i], _exchangeNames[i]);
            }
        }
    }

    /**
     * Mints the appropriate % of Net Asset Value of the CKToken from the deposited WETH in the rounds.
     * Fee(protocol fee + manager shared fee + manager fee in the module) will be used as slipage to trade on DEXs.
     * The exact amount protocol fee will be deliver to the protocol. Only remaining WETH will be paid to the manager as a fee.
     *
     * @param _ckToken                      Instance of the CKToken
     */
    function batchIssue(ICKToken _ckToken) external nonReentrant onlyValidAndInitializedCK(_ckToken) {
        // Get max input amount
        uint256 currentRound = roundNumbers[_ckToken];
        RoundInfo storage roundInfo = roundInfos[_ckToken][currentRound];
        uint256 maxInputAmount = roundInfo.totalEthDeposited;

        require(maxInputAmount > 0, "Quantity must be > 0");

        ActionInfo memory issueInfo = _createIssuanceInfo(_ckToken, address(weth), maxInputAmount);
        _validateIssuanceInfo(_ckToken, issueInfo);

        uint256 inputUsed = 0;
        uint256 outputAmount = issueInfo.ckTokenQuantity;

        // To issue ckTokenQuantity amount of CKs, swap the required underlying components amount
        (
            address[] memory components,
            uint256[] memory componentQuantities
        ) = basicIssuanceModule.getRequiredComponentUnitsForIssue(_ckToken, outputAmount);
        for (uint256 i = 0; i < components.length; i++) {
            IERC20 component_ = IERC20(components[i]);
            uint256 quantity_ = componentQuantities[i];
            if (address(component_) != address(weth)) {
                TradeInfo memory tradeInfo = _createTradeInfo(
                    _ckToken,
                    IERC20(component_),
                    quantity_,
                    issueInfo.totalFeePercentage
                );
                uint256 usedAmountForTrade = _executeTrade(tradeInfo);
                inputUsed = inputUsed.add(usedAmountForTrade);
            } else {
                inputUsed = inputUsed.add(quantity_);
            }

            // approve every component for basic issuance module
            if (component_.allowance(address(this), address(basicIssuanceModule)) < quantity_) {
                component_.safeIncreaseAllowance(address(basicIssuanceModule), quantity_);
            }
        }

        // Mint the CKToken
        basicIssuanceModule.issue(_ckToken, outputAmount, address(this));
        // Mark total minted CKToken amount;
        roundInfo.totalCkTokenIssued = outputAmount;

        // Sanity check
        uint256 inputUsedWithProtocolFee = inputUsed.add(issueInfo.protocolFees);
        require(inputUsedWithProtocolFee <= maxInputAmount, "Max input sanity check failed");

        // turn remaining amount into manager fee
        issueInfo.managerFee = maxInputAmount.sub(inputUsedWithProtocolFee);
        _transferFees(_ckToken, issueInfo);

        emit CKTokenBatchIssued(_ckToken, maxInputAmount, outputAmount, currentRound);

        // round move forward
        roundNumbers[_ckToken] = currentRound.add(1);
    }

    /**
     * Wrap ETH and then deposit
     *
     * @param _ckToken                      Instance of the CKToken
     */
    function depositEth(ICKToken _ckToken) external payable onlyValidAndInitializedCK(_ckToken) {
        weth.deposit{ value: msg.value }();
        _depositTo(_ckToken, msg.value, msg.sender);
    }

    /**
     * Deposit WETH
     *
     * @param _ckToken                      Instance of the CKToken
     * @param _amount                       Amount of WETH
     */
    function deposit(ICKToken _ckToken, uint256 _amount) external onlyValidAndInitializedCK(_ckToken) {
        weth.safeTransferFrom(msg.sender, address(this), _amount);
        _depositTo(_ckToken, _amount, msg.sender);
    }

    /**
     * Withdraw CKToken
     *
     * @param _ckToken                      Instance of the CKToken
     */
    function withdrawCKToken(ICKToken _ckToken) external onlyValidAndInitializedCK(_ckToken) {
        withdrawCKTokenTo(_ckToken, msg.sender);
    }

    /**
     * Withdraw CKToken within to a specific address
     *
     * @param _ckToken                      Instance of the CKToken
     * @param _to                           Address to withdraw to
     */
    function withdrawCKTokenTo(
        ICKToken _ckToken,
        address _to
    ) public nonReentrant onlyValidAndInitializedCK(_ckToken) {
        uint256 totalWithdrawablwAmount = 0;
        uint256 currentRound = roundNumbers[_ckToken];

        for (uint256 i = 0; i < currentRound; i++) {
            bytes32 userRoundHash = _getUserRoundHash(_to, i);
            RoundInfo storage roundInfo = roundInfos[_ckToken][i];
            uint256 userDepositAmount = userDeposits[_ckToken][userRoundHash];

            // skip if user has no deposit, all ckToken withdraw or ckTokens not even issued
            if (userDepositAmount == 0 || roundInfo.totalEthDeposited == 0 || roundInfo.totalCkTokenIssued == 0) {
                continue;
            }

            uint256 withdrawablwAmount = roundInfo.totalCkTokenIssued.mul(userDepositAmount).div(roundInfo.totalEthDeposited);

            roundInfo.totalEthDeposited = roundInfo.totalEthDeposited.sub(userDeposits[_ckToken][userRoundHash]);
            roundInfo.totalCkTokenIssued = roundInfo.totalCkTokenIssued.sub(withdrawablwAmount);
            userDeposits[_ckToken][userRoundHash] = 0;

            totalWithdrawablwAmount = totalWithdrawablwAmount.add(withdrawablwAmount);
        }

        require(totalWithdrawablwAmount > 0, "no claimable ckToken");

        _ckToken.transfer(_to, totalWithdrawablwAmount);
        emit WithdrawCKToken(_ckToken, msg.sender, _to, totalWithdrawablwAmount);
    }

    /**
     * Removes this module from the CKToken, via call by the CKToken.
     */
    function removeModule() external override {
        ICKToken ckToken_ = ICKToken(msg.sender);

        // delete tradeExecutionInfo
        address[] memory components = ckToken_.getComponents();
        for (uint256 i = 0; i < components.length; i++) {
            delete tradeExecutionInfo[ckToken_][IERC20(components[i])];
        }

        delete batchIssuanceSettings[ckToken_];
        // delete roundInfos[ckToken_];
        // delete userRounds[ckToken_];
    }

    /* ============ External Getter Functions ============ */

    /**
     * Get deposited ETH waiting for batchIssue
     *
     * @param _ckToken                      Instance of the CKToken
     * @param _of                           address of the user
     */
     function inputBalanceOf(ICKToken _ckToken, address _of) public view returns(uint256) {
        uint256 currentRound = roundNumbers[_ckToken];
        bytes32 userRoundHash = _getUserRoundHash(_of, currentRound);
        return userDeposits[_ckToken][userRoundHash];
    }

    /**
     * Get batch issued ckToken of an address
     *
     * @param _ckToken                      Instance of the CKToken
     * @param _of                           address of the user
     */
    function outputBalanceOf(ICKToken _ckToken, address _of) public view returns(uint256) {
        uint256 currentRound = roundNumbers[_ckToken];
        uint256 totalWithdrawablwAmount = 0;

        for (uint256 i = 0; i < currentRound; i++) {
            bytes32 userRoundHash = _getUserRoundHash(_of, i);
            RoundInfo memory roundInfo = roundInfos[_ckToken][i];
            uint256 userDepositAmount = userDeposits[_ckToken][userRoundHash];

            // skip if user has no deposit, all ckToken withdraw or ckTokens not even issued
            if (userDepositAmount == 0 || roundInfo.totalEthDeposited == 0 || roundInfo.totalCkTokenIssued == 0) {
                continue;
            }

            uint256 withdrawablwAmount = roundInfo.totalCkTokenIssued.mul(userDepositAmount).div(roundInfo.totalEthDeposited);
            totalWithdrawablwAmount = totalWithdrawablwAmount.add(withdrawablwAmount);
        }        

        return totalWithdrawablwAmount;
    }

    /**
     * Get current batch issue round number 
     *
     * @param _ckToken                      Instance of the CKToken
     */
    function getCurrentRound(ICKToken _ckToken) public view returns(uint256) {
        return roundNumbers[_ckToken];
    }

    /**
     * Get current batch issue round deposited eth
     *
     * @param _ckToken                      Instance of the CKToken
     */
    function getCurrentRoundDeposited(ICKToken _ckToken) public view returns(uint256) {
        return roundInfos[_ckToken][roundNumbers[_ckToken]].totalEthDeposited;
    }

    /**
     * Get manager fee by index
     *
     * @param _ckToken                      Instance of the CKToken
     * @param _managerFeeIndex              Manager fee index
     */
    function getManagerFee(ICKToken _ckToken, uint256 _managerFeeIndex) external view returns (uint256) {
        return batchIssuanceSettings[_ckToken].managerFees[_managerFeeIndex];
    }

    /**
     * Get batch issuance setting for a CK
     *
     * @param _ckToken                      Instance of the CKToken
     */
    function getBatchIssuanceSetting(ICKToken _ckToken) external view returns (BatchIssuanceSetting memory) {
        return batchIssuanceSettings[_ckToken];
    }

    /**
     * Get tradeExecutionParam for a component of a CK
     *
     * @param _ckToken                      Instance of the CKToken
     * @param _component                    ERC20 instance of the component
     */
    function getTradeExecutionParam(
        ICKToken _ckToken,
        IERC20 _component
    ) external view returns (TradeExecutionParams memory) {
        return tradeExecutionInfo[_ckToken][_component];
    }

    /* ============ Internal Functions ============ */

    /**
     * Deposit by user
     *
     * @param _ckToken                      Instance of the CKToken
     * @param _amount                       Amount of WETH
     * @param _to                           Address of depositor
     */
    function _depositTo(ICKToken _ckToken, uint256 _amount, address _to) internal {
        // if amount is zero return early
        if(_amount == 0) {
            return;
        }

        uint256 currentRound = roundNumbers[_ckToken];
        bytes32 userRoundHash = _getUserRoundHash(_to, currentRound);
        
        roundInfos[_ckToken][currentRound].totalEthDeposited = roundInfos[_ckToken][currentRound].totalEthDeposited.add(_amount);
        userDeposits[_ckToken][userRoundHash] = userDeposits[_ckToken][userRoundHash].add(_amount);

        emit Deposit(_ckToken, _to, _amount, currentRound);
    }

    /**
     * Create and return TradeInfo struct. Send Token is WETH
     *
     * @param _ckToken              Instance of the CKToken
     * @param _component            IERC20 component to trade
     * @param _receiveQuantity      Amount of the component asset 
     * @param _slippage             Limitation percentage 
     *
     * @return tradeInfo            Struct containing data for trade
     */
    function _createTradeInfo(
        ICKToken _ckToken,
        IERC20 _component,
        uint256 _receiveQuantity,
        uint256 _slippage
    )
        internal
        view
        virtual
        returns (TradeInfo memory tradeInfo)
    {
        // set the exchange info
        tradeInfo.exchangeAdapter = IIndexExchangeAdapter(
            getAndValidateAdapter(tradeExecutionInfo[_ckToken][_component].exchangeName)
        );
        tradeInfo.exchangeData = tradeExecutionInfo[_ckToken][_component].exchangeData;

        // set receive token info
        tradeInfo.receiveToken = address(_component);
        tradeInfo.receiveQuantity = _receiveQuantity;

        // exactSendQuantity is calculated based on the price from the oracle, not the price from the proper exchange
        uint256 receiveTokenPrice = _calculateComponentPrice(address(_component), address(weth));
        uint256 wethDecimals = ERC20(address(weth)).decimals();
        uint256 componentDecimals = ERC20(address(_component)).decimals();
        uint256 exactSendQuantity = tradeInfo.receiveQuantity
                                        .preciseMul(receiveTokenPrice)
                                        .mul(10**wethDecimals)
                                        .div(10**componentDecimals);
        // set max send limit
        uint256 unit_ = 1e18;
        tradeInfo.sendQuantityMax = exactSendQuantity.mul(unit_).div(unit_.sub(_slippage));
    }

    /**
     * Function handles all interactions with exchange.
     *
     * @param _tradeInfo            Struct containing trade information used in internal functions
     */
    function _executeTrade(TradeInfo memory _tradeInfo) internal returns (uint256) {
        ERC20(address(weth)).approve(_tradeInfo.exchangeAdapter.getSpender(), _tradeInfo.sendQuantityMax);

        (
            address targetExchange,
            uint256 callValue,
            bytes memory methodData
        ) = _tradeInfo.exchangeAdapter.getTradeCalldata(
            address(weth),
            _tradeInfo.receiveToken,
            address(this),
            false,
            _tradeInfo.sendQuantityMax,
            _tradeInfo.receiveQuantity,
            _tradeInfo.exchangeData
        );

        uint256 preTradeReserveAmount = weth.balanceOf(address(this));
        targetExchange.functionCallWithValue(methodData, callValue);
        uint256 postTradeReserveAmount = weth.balanceOf(address(this));

        uint256 usedAmount = preTradeReserveAmount.sub(postTradeReserveAmount);
        return usedAmount;
    }

    /**
     * Validate issuance info used internally.
     *
     * @param _ckToken              Instance of the CKToken
     * @param _issueInfo            Struct containing inssuance information used in internal functions
     */
    function _validateIssuanceInfo(ICKToken _ckToken, ActionInfo memory _issueInfo) internal view {
        // Check that total supply is greater than min supply needed for issuance
        // Note: A min supply amount is needed to avoid division by 0 when CKToken supply is 0
        require(
            _issueInfo.previousCKTokenSupply >= batchIssuanceSettings[_ckToken].minCKTokenSupply,
            "Supply must be greater than minimum issuance"
        );
    }

    /**
     * Create and return ActionInfo struct.
     *
     * @param _ckToken                  Instance of the CKToken
     * @param _reserveAsset             Address of reserve asset
     * @param _reserveAssetQuantity     Amount of the reserve asset 
     *
     * @return issueInfo                Struct containing data for issuance
     */
    function _createIssuanceInfo(
        ICKToken _ckToken,
        address _reserveAsset,
        uint256 _reserveAssetQuantity
    )
        internal
        view
        returns (ActionInfo memory)
    {
        ActionInfo memory issueInfo;

        issueInfo.previousCKTokenSupply = _ckToken.totalSupply();

        issueInfo.preFeeReserveQuantity = _reserveAssetQuantity;

        (issueInfo.totalFeePercentage, issueInfo.protocolFees, issueInfo.managerFee) = _getFees(
            _ckToken,
            issueInfo.preFeeReserveQuantity,
            PROTOCOL_ISSUE_MANAGER_REVENUE_SHARE_FEE_INDEX,
            PROTOCOL_ISSUE_DIRECT_FEE_INDEX,
            MANAGER_ISSUE_FEE_INDEX
        );

        issueInfo.netFlowQuantity = issueInfo.preFeeReserveQuantity
                                        .sub(issueInfo.protocolFees)
                                        .sub(issueInfo.managerFee);

        issueInfo.ckTokenQuantity = _getCKTokenMintQuantity(
            _ckToken,
            _reserveAsset,
            issueInfo.netFlowQuantity
        );

        issueInfo.newCKTokenSupply = issueInfo.ckTokenQuantity.add(issueInfo.previousCKTokenSupply);

        return issueInfo;
    }

    /**
     * Calculate CKToken mint amount.
     *
     * @param _ckToken                  Instance of the CKToken
     * @param _reserveAsset             Address of reserve asset
     * @param _netReserveFlows          Value of reserve asset net of fees 
     *
     * @return uint256                  Amount of CKToken to mint
     */
    function _getCKTokenMintQuantity(
        ICKToken _ckToken,
        address _reserveAsset,
        uint256 _netReserveFlows
    )
        internal
        view
        returns (uint256)
    {

        // Get valuation of the CKToken with the quote asset as the reserve asset. Returns value in precise units (1e18)
        // Reverts if price is not found
        uint256 ckTokenValuation = controller.getCKValuer().calculateCKTokenValuation(_ckToken, _reserveAsset);

        // Get reserve asset decimals
        uint256 reserveAssetDecimals = ERC20(_reserveAsset).decimals();
        uint256 normalizedTotalReserveQuantityNetFees = _netReserveFlows.preciseDiv(10 ** reserveAssetDecimals);

        // Calculate CKTokens to mint to issuer
        return normalizedTotalReserveQuantityNetFees.preciseDiv(ckTokenValuation);
    }

    /**
     * Returns the fees attributed to the manager and the protocol. The fees are calculated as follows:
     *
     * ManagerFee = (manager fee % - % to protocol) * reserveAssetQuantity, will be recalculated after trades
     * Protocol Fee = (% manager fee share + direct fee %) * reserveAssetQuantity
     *
     * @param _ckToken                      Instance of the CKToken
     * @param _reserveAssetQuantity         Quantity of reserve asset to calculate fees from
     * @param _protocolManagerFeeIndex      Index to pull rev share batch Issuance fee from the Controller
     * @param _protocolDirectFeeIndex       Index to pull direct batch issuance fee from the Controller
     * @param _managerFeeIndex              Index from BatchIssuanceSettings (0 = issue fee, 1 = redeem fee)
     *
     * @return  uint256                     Total fee percentage
     * @return  uint256                     Fees paid to the protocol in reserve asset
     * @return  uint256                     Fees paid to the manager in reserve asset
     */
    function _getFees(
        ICKToken _ckToken,
        uint256 _reserveAssetQuantity,
        uint256 _protocolManagerFeeIndex,
        uint256 _protocolDirectFeeIndex,
        uint256 _managerFeeIndex
    )
        internal
        view
        returns (uint256, uint256, uint256)
    {
        (uint256 protocolFeePercentage, uint256 managerFeePercentage) = _getProtocolAndManagerFeePercentages(
            _ckToken,
            _protocolManagerFeeIndex,
            _protocolDirectFeeIndex,
            _managerFeeIndex
        );

        // total fee percentage
        uint256 totalFeePercentage = protocolFeePercentage.add(managerFeePercentage);

        // Calculate total notional fees
        uint256 protocolFees = protocolFeePercentage.preciseMul(_reserveAssetQuantity);
        uint256 managerFee = managerFeePercentage.preciseMul(_reserveAssetQuantity);

        return (totalFeePercentage, protocolFees, managerFee);
    }

    /**
     * Returns the fee percentages of the manager and the protocol.
     *
     * @param _ckToken                      Instance of the CKToken
     * @param _protocolManagerFeeIndex      Index to pull rev share Batch Issuance fee from the Controller
     * @param _protocolDirectFeeIndex       Index to pull direct Batc issuance fee from the Controller
     * @param _managerFeeIndex              Index from BatchIssuanceSettings (0 = issue fee, 1 = redeem fee)
     *
     * @return  uint256                     Fee percentage to the protocol in reserve asset
     * @return  uint256                     Fee percentage to the manager in reserve asset
     */
    function _getProtocolAndManagerFeePercentages(
        ICKToken _ckToken,
        uint256 _protocolManagerFeeIndex,
        uint256 _protocolDirectFeeIndex,
        uint256 _managerFeeIndex
    )
        internal
        view
        returns(uint256, uint256)
    {
        // Get protocol fee percentages
        uint256 protocolDirectFeePercent = controller.getModuleFee(address(this), _protocolDirectFeeIndex);
        uint256 protocolManagerShareFeePercent = controller.getModuleFee(address(this), _protocolManagerFeeIndex);
        uint256 managerFeePercent = batchIssuanceSettings[_ckToken].managerFees[_managerFeeIndex];
        
        // Calculate revenue share split percentage
        uint256 protocolRevenueSharePercentage = protocolManagerShareFeePercent.preciseMul(managerFeePercent);
        uint256 managerRevenueSharePercentage = managerFeePercent.sub(protocolRevenueSharePercentage);
        uint256 totalProtocolFeePercentage = protocolRevenueSharePercentage.add(protocolDirectFeePercent);

        return (totalProtocolFeePercentage, managerRevenueSharePercentage);
    }

    /**
     * Get the price of the component
     *
     * @param _component       Component to get the price for
     * @param _quoteAsset      Address of token to quote valuation in
     *
     * @return uint256         Component's price
     */
    function _calculateComponentPrice(address _component, address _quoteAsset) internal view returns (uint256) {
        IPriceOracle priceOracle = controller.getPriceOracle();
        address masterQuoteAsset = priceOracle.masterQuoteAsset();
        
        // Get component price from price oracle. If price does not exist, revert.
        uint256 componentPrice = priceOracle.getPrice(_component, masterQuoteAsset);
        if (masterQuoteAsset != _quoteAsset) {
            uint256 quoteToMaster = priceOracle.getPrice(_quoteAsset, masterQuoteAsset);
            componentPrice = componentPrice.preciseDiv(quoteToMaster);
        }

        return componentPrice;
    }

    /**
     * Transfer fees(WETH) from module to appropriate fee recipients
     *
     * @param _ckToken         Instance of the CKToken
     * @param _issueInfo       Issuance information, contains fee recipient address and fee amounts
     */
    function _transferFees(ICKToken _ckToken, ActionInfo memory _issueInfo) internal {
        if (_issueInfo.protocolFees > 0) {
            weth.safeTransfer(controller.feeRecipient(), _issueInfo.protocolFees);
        }

        if (_issueInfo.managerFee > 0) {
            weth.safeTransfer(batchIssuanceSettings[_ckToken].feeRecipient, _issueInfo.managerFee);
        }
    }

    /**
     * Generate hash key with (address, roundnumber) to get user deposit for a CKToken in a specific round.
     *
     * @param _account          Address made deposit
     * @param roundNumber       round an address deposited
     */
    function _getUserRoundHash(address _account, uint256 roundNumber) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(_account, roundNumber));
    }
}