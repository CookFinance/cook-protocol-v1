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
import { IBatchIssuanceHook } from "../../interfaces/IBatchIssuanceHook.sol";
import { IBasicIssuanceModule } from "../../interfaces/IBasicIssuanceModule.sol";
import { IIndexExchangeAdapter } from "../../interfaces/IIndexExchangeAdapter.sol";
import { IPriceOracle } from "../../interfaces/IPriceOracle.sol";
import { ICKToken } from "../../interfaces/ICKToken.sol";
import { IWETH } from "../../interfaces/external/IWETH.sol";
import { ModuleBase } from "../lib/ModuleBase.sol";
import { PreciseUnitMath } from "../../lib/PreciseUnitMath.sol";

import "hardhat/console.sol"; // TODO: remove this on production
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
    using Address for address;

    /* ============ Events ============ */

    event CKTokenBatchIssued(
        ICKToken indexed _ckToken,
        address _issuer,
        address _to,
        address _reserveAsset,
        address _hookContract,
        uint256 _ckTokenQuantity,
        uint256 _managerFee,
        uint256 _premium
    );
    event ManagerFeeEdited(uint256 _newManagerFee, uint256 _index);
    event FeeRecipientEdited(address _feeRecipient);
    event RoundInputCapEdited(uint256 _oldRoundInputCap, uint256 _newRoundInputCap);
    event AssetExchangeUpdated(address indexed _component, string _newExchangeName);
    event Deposit(address indexed _to, uint256 _amount);
    event Withdraw(address indexed _from, address indexed _to, uint256 _inputAmount, uint256 _outputAmount);

    /* ============ Structs ============ */

    struct BatchIssuanceSetting {
        address feeRecipient;                          // Manager fee recipient
        uint256[2] managerFees;                        // Manager fees. 0 index is issue and 1 index is redeem fee (0.01% = 1e14, 1% = 1e16)
        uint256 maxManagerFee;                         // Maximum fee manager is allowed to set for issue and redeem
        uint256 minCKTokenSupply;                      // Minimum CKToken supply required for issuance and redemption 
                                                       // to prevent dramatic inflationary changes to the CKToken's position multiplier
    }

    struct ActionInfo {
        uint256 preFeeReserveQuantity;                 // Reserve value before fees; During issuance, represents raw quantity
        uint256 totalFeePercentage;                    // Total protocol fees (direct + manager revenue share)
        uint256 protocolFees;                          // Total protocol fees (direct + manager revenue share)
        uint256 managerFee;                            // Total manager fee paid in reserve asset
        uint256 netFlowQuantity;                       // When issuing, quantity of reserve asset sent to CKToken
        uint256 ckTokenQuantity;                       // When issuing, quantity of CKTokens minted to mintee
        uint256 previousCKTokenSupply;                 // CKToken supply prior to issue/redeem action
        uint256 newCKTokenSupply;                      // CKToken supply after issue/redeem action
    }

    struct TradeExecutionParams {
        string exchangeName;             // Exchange adapter name
        bytes exchangeData;              // Arbitrary data that can be used to encode exchange specific settings (fee tier) or features (multi-hop)
    }

    struct TradeInfo {
        IIndexExchangeAdapter exchangeAdapter;      // Instance of Exchange Adapter
        address receiveToken;                       // Address of token being bought
        uint256 sendQuantityMax;                    // Max amount of tokens to sent to the exchange
        uint256 receiveQuantity;                    // Amount of tokens receiving
        bytes exchangeData;                         // Arbitrary data for executing trade on given exchange
    }

    struct Round {
        uint256 totalDeposited;
        mapping(address => uint256) deposits;

        uint256 totalBakedInput;
        uint256 totalOutput;
    }

    /* ============ Constants ============ */

    // 0 index stores the manager fee in managerFees array, percentage charged on issue (denominated in reserve asset)
    uint256 constant internal MANAGER_ISSUE_FEE_INDEX = 0;
    // 0 index stores the manager revenue share protocol fee % on the controller, charged in the issuance function
    uint256 constant internal PROTOCOL_ISSUE_MANAGER_REVENUE_SHARE_FEE_INDEX = 0;
    // 2 index stores the direct protocol fee % on the controller, charged in the issuance function
    uint256 constant internal PROTOCOL_ISSUE_DIRECT_FEE_INDEX = 2;

    /* ============ State Variables ============ */

    IWETH public immutable weth;                            // Wrapped ETH address
    ICKToken public ckToken;                                // CKToken being managed with the contract
    IBasicIssuanceModule public basicIssuanceModule;        // Basic Issuance Module
    IBatchIssuanceHook public batchIssuanceHook;            // Issuance hook
    BatchIssuanceSetting public batchIssuanceSetting;       // Batch issuance setting
    mapping(IERC20 => TradeExecutionParams) public tradeExecutionInfo;     // Mapping of component to execution params

    
    uint256 public roundInputCap;                           // Input amount size per round
    Round[] public rounds;                                  // Array of rounds
    mapping(address => uint256[]) private userRounds;       // User round, a user can have multiple rounds

    /* ============ Constructor ============ */

    /**
     * Set state controller state variable
     *
     * @param _controller             Address of controller contract
     */
    constructor(IController _controller, IWETH _weth) public ModuleBase(_controller) {
        weth = _weth;
    }

    /* ============ External Functions ============ */

    /**
     * Initializes this module to the CKToken with issuance-related hooks. Only callable by the CKToken's manager.
     * Hook addresses are optional. Address(0) means that no hook will be called
     *
     * @param _ckToken              Instance of the CKToken to issue
     * @param _basicIssuanceModule  Instance of the basic issuance module
     * @param _preIssueHook         Instance of the Manager Contract with the Pre-Issuance Hook function
     * @param _batchIssuanceSetting BatchIssuanceSetting struct define parameters
     * @param _roundInputCap        Maximum input amount per round
     */
    function initialize(
        ICKToken _ckToken,
        IBasicIssuanceModule _basicIssuanceModule,
        IBatchIssuanceHook _preIssueHook,
        BatchIssuanceSetting memory _batchIssuanceSetting,
        uint256 _roundInputCap
    )
        external
        onlyCKManager(_ckToken, msg.sender)
        onlyValidAndPendingCK(_ckToken)
    {
        require(_batchIssuanceSetting.maxManagerFee < PreciseUnitMath.preciseUnit(), "Max manager fee must be less than 100%");
        require(_batchIssuanceSetting.managerFees[0] <= _batchIssuanceSetting.maxManagerFee, "Manager issue fee must be less than max");
        require(_batchIssuanceSetting.managerFees[1] <= _batchIssuanceSetting.maxManagerFee, "Manager redeem fee must be less than max");
        require(_batchIssuanceSetting.feeRecipient != address(0), "Fee Recipient must be non-zero address.");
        require(_batchIssuanceSetting.minCKTokenSupply > 0, "Min CKToken supply must be greater than 0");

        // create first empty round
        rounds.push();
        // set round input limit
        roundInputCap = _roundInputCap;

        // set basic issuance module
        basicIssuanceModule = _basicIssuanceModule;
        // set batch issuance hook
        batchIssuanceHook = _preIssueHook;
        // set batch issuance setting
        batchIssuanceSetting = _batchIssuanceSetting;

        // initialize module for the CKToken
        ckToken = _ckToken;
        _ckToken.initializeModule();
    }

    /**
     * CK MANAGER ONLY. Edit manager fee
     *
     * @param _managerFeePercentage         Manager fee percentage in 10e16 (e.g. 10e16 = 1%)
     * @param _managerFeeIndex              Manager fee index. 0 index is issue fee, 1 index is redeem fee
     */
    function editManagerFee(
        uint256 _managerFeePercentage,
        uint256 _managerFeeIndex
    )
        external
        onlyManagerAndValidCK(ckToken)
    {
        require(_managerFeePercentage <= batchIssuanceSetting.maxManagerFee, "Manager fee must be less than maximum allowed");
        
        batchIssuanceSetting.managerFees[_managerFeeIndex] = _managerFeePercentage;

        emit ManagerFeeEdited(_managerFeePercentage, _managerFeeIndex);
    }

    /**
     * CK MANAGER ONLY. Edit the manager fee recipient
     *
     * @param _managerFeeRecipient          Manager fee recipient
     */
    function editFeeRecipient(address _managerFeeRecipient) external onlyManagerAndValidCK(ckToken) {
        require(_managerFeeRecipient != address(0), "Fee recipient must not be 0 address");
        
        batchIssuanceSetting.feeRecipient = _managerFeeRecipient;

        emit FeeRecipientEdited(_managerFeeRecipient);
    }

    /**
     * CK MANAGER ONLY. Edit the maximum input amount per round
     *
     * @param _roundInputCap                Maximum input amount per round
     */
    function editRoundInputCap(uint256 _roundInputCap) external onlyManagerAndValidCK(ckToken) {
        emit RoundInputCapEdited(roundInputCap, _roundInputCap);
        roundInputCap = _roundInputCap;
    }

    /**
     * CK MANAGER ONLY: Set exchange for components of the CKToken. Can be called at anytime.
     *
     * @param _components           Array of components
     * @param _exchangeNames        Array of exchange names mapping to correct component
     */
    function setExchanges(
        address[] memory _components,
        string[] memory _exchangeNames
    )
        external
        onlyManagerAndValidCK(ckToken)
    {
        _components.validatePairsWithArray(_exchangeNames);

        for (uint256 i = 0; i < _components.length; i++) {
            if (_components[i] != address(weth)) {

                require(
                    controller.getIntegrationRegistry().isValidIntegration(address(this), _exchangeNames[i]),
                    "Unrecognized exchange name"
                );

                tradeExecutionInfo[IERC20(_components[i])].exchangeName = _exchangeNames[i];
                emit AssetExchangeUpdated(_components[i], _exchangeNames[i]);
            }
        }
    }

    /**
     * Mints the appropriate % of Net Asset Value of the CKToken from the deposited WETH in the rounds.
     * Fee(protocol fee + manager shared fee + manager fee in the module) will be used as slipage to trade on DEXs.
     * The exact amount protocol fee will be deliver to the protocol. Only remaining WETH will be paid to the manager as a fee.
     *
     * @param _rounds                      Array of round indexes
     */
    function batchIssue(uint256[] memory _rounds) external {
        uint256 maxInputAmount;

        // Get max input amount
        for(uint256 i = 0; i < _rounds.length; i ++) {
        
            // Prevent round from being baked twice
            if(i != 0) {
                require(_rounds[i] > _rounds[i - 1], "Rounds out of order");
            }

            Round storage round = rounds[_rounds[i]];
            maxInputAmount += (round.totalDeposited - round.totalBakedInput);
        }

        require(maxInputAmount > 0, "Quantity must be > 0");

        _callPreIssueHooks(address(weth), maxInputAmount, msg.sender);
        ActionInfo memory issueInfo = _createIssuanceInfo(address(weth), maxInputAmount);
        _validateIssuanceInfo(issueInfo);

        uint256 inputUsed = 0;
        uint256 outputAmount = issueInfo.ckTokenQuantity;

        // For each position, transfer the required underlying to the CKToken
        (
            address[] memory components,
            uint256[] memory componentQuantities
        ) = basicIssuanceModule.getRequiredComponentUnitsForIssue(ckToken, outputAmount);
        for (uint256 i = 0; i < components.length; i++) {
            TradeInfo memory tradInfo = _createTradeInfo(
                IERC20(components[i]),
                componentQuantities[i],
                issueInfo.totalFeePercentage
            );
            uint256 usedAmountForTrade = _executeTrade(tradInfo);
            inputUsed += usedAmountForTrade;

            // approve every component for basic issuance module
            ERC20(address(components[i])).approve(address(basicIssuanceModule), componentQuantities[i]);
        }

        // Mint the CKToken
        basicIssuanceModule.issue(ckToken, outputAmount, address(this));

        uint256 inputUsedRemaining = maxInputAmount;

        for(uint256 i = 0; i < _rounds.length; i ++) {
            Round storage round = rounds[_rounds[i]];

            uint256 roundTotalBaked = round.totalBakedInput;
            uint256 roundTotalDeposited = round.totalDeposited;
            uint256 roundInputBaked = (roundTotalDeposited.sub(roundTotalBaked)).min(inputUsedRemaining);

            // Skip round if it is already baked
            if(roundInputBaked == 0) {
                continue;
            }

            uint256 roundOutputBaked = outputAmount.mul(roundInputBaked).div(maxInputAmount);

            round.totalBakedInput = roundTotalBaked.add(roundInputBaked);
            inputUsedRemaining = inputUsedRemaining.sub(roundInputBaked);
            round.totalOutput = round.totalOutput.add(roundOutputBaked);

            // Sanity check for round
            require(round.totalBakedInput <= round.totalDeposited, "Round input sanity check failed");
        }

        // Sanity check
        uint256 inputUsedWithProtocolFee = inputUsed.add(issueInfo.protocolFees);
        require(inputUsedWithProtocolFee <= maxInputAmount, "Max input sanity check failed");

        // turn remaining amount into manager fee
        issueInfo.managerFee = maxInputAmount.sub(inputUsedWithProtocolFee);

        _transferFees(issueInfo);
    }

    /**
     * Wrap ETH and then deposit
     */
    function depositEth() external payable {
        weth.deposit{ value: msg.value }();
        _depositTo(msg.value, msg.sender);
    }

    /**
     * Deposit WETH
     * @param _amount                       Amount of WETH
     */
    function deposit(uint256 _amount) external {
        weth.safeTransferFrom(msg.sender, address(this), _amount);
        _depositTo(_amount, msg.sender);
    }

    /**
     * Withdraw within the number of rounds limit
     * @param _roundsLimit                  Number of rounds limit
     */
    function withdraw(uint256 _roundsLimit) external {
        withdrawTo(msg.sender, _roundsLimit);
    }

    /**
     * Withdraw within the number of rounds limit, to a specific address
     * @param _to                           Address to withdraw to
     * @param _roundsLimit                  Number of rounds limit
     */
    function withdrawTo(address _to, uint256 _roundsLimit) public nonReentrant {
        uint256 inputAmount;
        uint256 outputAmount;
        
        uint256 userRoundsLength = userRounds[msg.sender].length;
        uint256 numRounds = userRoundsLength.min(_roundsLimit);

        for(uint256 i = 0; i < numRounds; i ++) {
            // start at end of array for efficient popping of elements
            uint256 roundIndex = userRounds[msg.sender][userRoundsLength - i - 1];
            Round storage round = rounds[roundIndex];

            // amount of input of user baked
            uint256 bakedInput = round.deposits[msg.sender] * round.totalBakedInput / round.totalDeposited;

            // amount of output the user is entitled to
            uint256 userRoundOutput;
            if(bakedInput == 0) {
                userRoundOutput = 0;
            } else {
                userRoundOutput = round.totalOutput * bakedInput / round.totalBakedInput;
            }
            
            // unbaked input
            inputAmount += round.deposits[msg.sender] - bakedInput;
            //amount of output the user is entitled to
            outputAmount += userRoundOutput;

            round.totalDeposited -= round.deposits[msg.sender] - bakedInput;
            round.deposits[msg.sender] = 0;
            round.totalBakedInput -= bakedInput;

            round.totalOutput -= userRoundOutput;

            // pop of user round
            userRounds[msg.sender].pop();
        }

        if(inputAmount != 0) {
            // handle rounding issues due to integer division inaccuracies
            inputAmount = inputAmount.min(weth.balanceOf(address(this)));
            weth.safeTransfer(_to, inputAmount);
        }
        
        if(outputAmount != 0) {
            // handle rounding issues due to integer division inaccuracies
            outputAmount = outputAmount.min(ckToken.balanceOf(address(this)));
            ckToken.transfer(_to, outputAmount);
        }

        emit Withdraw(msg.sender, _to, inputAmount, outputAmount);
    }

    /**
     * Reverts as this module should not be removable after added. No need to remove.
     */
    function removeModule() external override {
        revert("The BatchIssuanceModule module cannot be removed");
    }

    /* ============ External Getter Functions ============ */

    /**
     * Get manager fee by index
     * @param _managerFeeIndex              Manager fee index
     */
    function getManagerFee(uint256 _managerFeeIndex) external view returns (uint256) {
        return batchIssuanceSetting.managerFees[_managerFeeIndex];
    }

    /**
     * Get round input of an address(user)
     *
     * @param _round                        index of the round
     * @param _of                           address of the user
     */
    function roundInputBalanceOf(uint256 _round, address _of) public view returns(uint256) {
        Round storage round = rounds[_round];
        // if there are zero deposits the input balance of `_of` would be zero too
        if(round.totalDeposited == 0) {
            return 0;
        }
        uint256 bakedInput = round.deposits[_of].mul(round.totalBakedInput).div(round.totalDeposited);
        return round.deposits[_of].sub(bakedInput);
    }

    /**
     * Get total input of an address(user)
     *
     * @param _of                           address of the user
     */
    function inputBalanceOf(address _of) public view returns(uint256) {
        uint256 roundsCount = userRounds[_of].length;

        uint256 balance;

        for(uint256 i = 0; i < roundsCount; i ++) {
            balance = balance.add(roundInputBalanceOf(userRounds[_of][i], _of));
        }

        return balance;
    }

    /**
     * Get round output of an address(user)
     *
     * @param _round                        index of the round
     * @param _of                           address of the user
     */
    function roundOutputBalanceOf(uint256 _round, address _of) public view returns(uint256) {
        Round storage round = rounds[_round];

        if(round.totalBakedInput == 0) {
            return 0;
        }

        //amount of input of user baked
        uint256 bakedInput = round.deposits[_of].mul(round.totalBakedInput).div(round.totalDeposited);
        //amount of output the user is entitled to
        uint256 userRoundOutput = round.totalOutput.mul(bakedInput).div(round.totalBakedInput);

        return userRoundOutput;
    }

    /**
     * Get total output of an address(user)
     *
     * @param _of                           address of the user
     */
    function outputBalanceOf(address _of) external view returns(uint256) {
        uint256 roundsCount = userRounds[_of].length;

        uint256 balance;

        for(uint256 i = 0; i < roundsCount; i ++) {
            balance = balance.add(roundOutputBalanceOf(userRounds[_of][i], _of));
        }

        return balance;
    }

    /**
     * Get user's round count
     *
     * @param _user                         address of the user
     */
    function getUserRoundsCount(address _user) external view returns(uint256) {
        return userRounds[_user].length;
    }

    /**
     * Get total round count
     */
    function getRoundsCount() external view returns(uint256) {
        return rounds.length;
    }

    /* ============ Internal Functions ============ */

    /**
     * Deposit by user by round
     * @param _amount                       Amount of WETH
     * @param _to                           Address of depositor
     */
    function _depositTo(uint256 _amount, address _to) internal {
        // if amount is zero return early
        if(_amount == 0) {
            return;
        }

        uint256 currentRound = rounds.length.sub(1);
        uint256 deposited = 0;

        while(deposited < _amount) {
            //if the current round does not exist create it
            if(currentRound >= rounds.length) {
                rounds.push();
            }

            //if the round is already partially baked create a new round
            if(rounds[currentRound].totalBakedInput != 0) {
                currentRound = currentRound.add(1);
                rounds.push();
            }

            Round storage round = rounds[currentRound];

            uint256 roundDeposit = (_amount.sub(deposited)).min(roundInputCap.sub(round.totalDeposited));

            round.totalDeposited = round.totalDeposited.add(roundDeposit);
            round.deposits[_to] = round.deposits[_to].add(roundDeposit);

            deposited += roundDeposit;

            // only push rounds we are actually in
            if(roundDeposit != 0) {
                _pushUserRound(_to, currentRound);
            }

            // if full amount assigned to rounds break the loop
            if(deposited == _amount) {
                break;
            }

            currentRound = currentRound.add(1);
        }

        emit Deposit(_to, _amount);
    }

    /**
     * If a pre-issue hook has been configured, call the external-protocol contract. Pre-issue hook logic
     * can contain arbitrary logic including validations, external function calls, etc.
     *
     * @param _reserveAsset                 Reserve asset address
     * @param _reserveAssetQuantity         Reserve asset quantity
     * @param _caller                       Caller address
     */
    function _callPreIssueHooks(
        address _reserveAsset,
        uint256 _reserveAssetQuantity,
        address _caller
    )
        internal
        returns(address)
    {
        if (address(batchIssuanceHook) != address(0)) {
            batchIssuanceHook.invokePreIssueHook(ckToken, _reserveAsset, _reserveAssetQuantity, _caller);
            return address(batchIssuanceHook);
        }

        return address(0);
    }

    /**
     * Create and return TradeInfo struct. Send Token is WETH
     *
     * @param _component            IERC20 component to trade
     * @param _receiveQuantity      Amount of the component asset 
     * @param _slippage             Limitation percentage 
     *
     * @return tradeInfo            Struct containing data for trade
     */
    function _createTradeInfo(
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
        tradeInfo.exchangeAdapter = IIndexExchangeAdapter(getAndValidateAdapter(tradeExecutionInfo[_component].exchangeName));
        tradeInfo.exchangeData = tradeExecutionInfo[_component].exchangeData;

        // set receive token info
        tradeInfo.receiveToken = address(_component);
        tradeInfo.receiveQuantity = _receiveQuantity;

        // exactSendQuantity is calculated based on the price from the oracle, not the price from the proper exchange
        uint256 receiveTokenPrice = _calculateComponentPrice(address(_component), address(weth));
        uint256 wethDecimals = ERC20(address(weth)).decimals();
        uint256 componentDecimals = ERC20(address(_component)).decimals();
        uint256 exactSendQuantity = tradeInfo.receiveQuantity.preciseMul(receiveTokenPrice).mul(10**wethDecimals).div(10**componentDecimals);
        // set max send limit
        uint256 unit_ = 10**18;
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
     * @param _issueInfo            Struct containing inssuance information used in internal functions
     */
    function _validateIssuanceInfo(ActionInfo memory _issueInfo) internal view {
        // Check that total supply is greater than min supply needed for issuance
        // Note: A min supply amount is needed to avoid division by 0 when CKToken supply is 0
        require(
            _issueInfo.previousCKTokenSupply >= batchIssuanceSetting.minCKTokenSupply,
            "Supply must be greater than minimum issuance"
        );
    }

    /**
     * Create and return ActionInfo struct.
     *
     * @param _reserveAsset             Address of reserve asset
     * @param _reserveAssetQuantity     Amount of the reserve asset 
     *
     * @return issueInfo                Struct containing data for issuance
     */
    function _createIssuanceInfo(
        address _reserveAsset,
        uint256 _reserveAssetQuantity
    )
        internal
        view
        returns (ActionInfo memory)
    {
        ActionInfo memory issueInfo;

        issueInfo.previousCKTokenSupply = ckToken.totalSupply();

        issueInfo.preFeeReserveQuantity = _reserveAssetQuantity;

        (issueInfo.totalFeePercentage, issueInfo.protocolFees, issueInfo.managerFee) = _getFees(
            issueInfo.preFeeReserveQuantity,
            PROTOCOL_ISSUE_MANAGER_REVENUE_SHARE_FEE_INDEX,
            PROTOCOL_ISSUE_DIRECT_FEE_INDEX,
            MANAGER_ISSUE_FEE_INDEX
        );

        issueInfo.netFlowQuantity = issueInfo.preFeeReserveQuantity.sub(issueInfo.protocolFees).sub(issueInfo.managerFee);

        issueInfo.ckTokenQuantity = _getCKTokenMintQuantity(
            _reserveAsset,
            issueInfo.netFlowQuantity
        );

        issueInfo.newCKTokenSupply = issueInfo.ckTokenQuantity.add(issueInfo.previousCKTokenSupply);

        return issueInfo;
    }

    /**
     * Calculate CKToken mint amount.
     *
     * @param _reserveAsset             Address of reserve asset
     * @param _netReserveFlows          Value of reserve asset net of fees 
     *
     * @return uint256                  Amount of CKToken to mint
     */
    function _getCKTokenMintQuantity(
        address _reserveAsset,
        uint256 _netReserveFlows
    )
        internal
        view
        returns (uint256)
    {

        // Get valuation of the CKToken with the quote asset as the reserve asset. Returns value in precise units (1e18)
        // Reverts if price is not found
        uint256 ckTokenValuation = controller.getCKValuer().calculateCKTokenValuation(ckToken, _reserveAsset);

        // Get reserve asset decimals
        uint256 reserveAssetDecimals = ERC20(_reserveAsset).decimals();
        uint256 normalizedTotalReserveQuantityNetFees = _netReserveFlows.preciseDiv(10 ** reserveAssetDecimals);

        // Calculate CKTokens to mint to issuer
        return normalizedTotalReserveQuantityNetFees.preciseDiv(ckTokenValuation);
    }

    /**
     * Add new roundId to user's rounds array
     *
     * @param _to                       Address of depositor
     * @param _roundId                  Round id to add in userRounds
     */
    function _pushUserRound(address _to, uint256 _roundId) internal {
        // only push when its not already added
        if(userRounds[_to].length == 0 || userRounds[_to][userRounds[_to].length - 1] != _roundId) {
            userRounds[_to].push(_roundId);
        }
    }

    /**
     * Returns the fees attributed to the manager and the protocol. The fees are calculated as follows:
     *
     * ManagerFee = (manager fee % - % to protocol) * reserveAssetQuantity, will be recalculated after trades
     * Protocol Fee = (% manager fee share + direct fee %) * reserveAssetQuantity
     *
     * @param _reserveAssetQuantity         Quantity of reserve asset to calculate fees from
     * @param _protocolManagerFeeIndex      Index to pull rev share NAV Issuance fee from the Controller
     * @param _protocolDirectFeeIndex       Index to pull direct NAV issuance fee from the Controller
     * @param _managerFeeIndex              Index from NAVIssuanceSettings (0 = issue fee, 1 = redeem fee)
     *
     * @return  uint256                     Total fee percentage
     * @return  uint256                     Fees paid to the protocol in reserve asset
     * @return  uint256                     Fees paid to the manager in reserve asset
     */
    function _getFees(
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
     * @param _protocolManagerFeeIndex      Index to pull rev share NAV Issuance fee from the Controller
     * @param _protocolDirectFeeIndex       Index to pull direct NAV issuance fee from the Controller
     * @param _managerFeeIndex              Index from NAVIssuanceSettings (0 = issue fee, 1 = redeem fee)
     *
     * @return  uint256                     Fee percentage to the protocol in reserve asset
     * @return  uint256                     Fee percentage to the manager in reserve asset
     */
    function _getProtocolAndManagerFeePercentages(
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
        uint256 managerFeePercent = batchIssuanceSetting.managerFees[_managerFeeIndex];
        
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
     * @param _issueInfo       Issuance information, contains fee recipient address and fee amounts
     */
    function _transferFees(ActionInfo memory _issueInfo) internal {
        if (_issueInfo.protocolFees > 0) {
            weth.transfer(controller.feeRecipient(), _issueInfo.protocolFees);
        }

        if (_issueInfo.managerFee > 0) {
            weth.transfer(batchIssuanceSetting.feeRecipient, _issueInfo.managerFee);
        }
    }
}