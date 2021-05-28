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
import { Math } from "@openzeppelin/contracts/math/Math.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/SafeCast.sol";
import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";

import { AddressArrayUtils } from "../../lib/AddressArrayUtils.sol";
import { IController } from "../../interfaces/IController.sol";
import { IIndexExchangeAdapter } from "../../interfaces/IIndexExchangeAdapter.sol";
import { Invoke } from "../lib/Invoke.sol";
import { ICKToken } from "../../interfaces/ICKToken.sol";
import { IWETH } from "../../interfaces/external/IWETH.sol";
import { ModuleBase } from "../lib/ModuleBase.sol";
import { Position } from "../lib/Position.sol";
import { PreciseUnitMath } from "../../lib/PreciseUnitMath.sol";
import { Uint256ArrayUtils } from "../../lib/Uint256ArrayUtils.sol";

/**
 * @title GeneralIndexModule
 * @author Cook Finance
 *
 * Smart contract that facilitates rebalances for indices. Manager can update allocation by calling startRebalance().
 * There is no "end" to a rebalance, however once there are no more tokens to sell the rebalance is effectively over
 * until the manager calls startRebalance() again with a new allocation. Once a new allocation is passed in, allowed
 * traders can submit rebalance transactions by calling trade() and specifying the component they wish to rebalance.
 * All parameterizations for a trade are set by the manager ahead of time, including max trade size, coolOffPeriod bet-
 * ween trades, and exchange to trade on. WETH is used as the quote asset for all trades, near the end of rebalance
 * tradeRemaingingWETH() or raiseAssetTargets() can be called to clean up any excess WETH positions. Once a component's
 * target allocation is met any further attempted trades of that component will revert.
 *
 * SECURITY ASSUMPTION:
 *  - Works with following modules: StreamingFeeModule, BasicIssuanceModule (any other module additions to CKs using
 *    this module need to be examined separately)
 */
contract GeneralIndexModule is ModuleBase, ReentrancyGuard {
    using SafeCast for int256;
    using SafeCast for uint256;
    using SafeMath for uint256;
    using Position for uint256;
    using Math for uint256;
    using Position for ICKToken;
    using Invoke for ICKToken;
    using AddressArrayUtils for address[];
    using AddressArrayUtils for IERC20[];
    using Uint256ArrayUtils for uint256[];

    /* ============ Struct ============ */

    struct TradeExecutionParams {
        uint256 targetUnit;              // Target unit of component for CK
        uint256 maxSize;                 // Max trade size in precise units
        uint256 coolOffPeriod;           // Required time between trades for the asset
        uint256 lastTradeTimestamp;      // Timestamp of last trade
        string exchangeName;             // Exchange adapter name
        bytes exchangeData;              // Arbitrary data that can be used to encode exchange specific settings (fee tier) or features (multi-hop)
    }

    struct TradePermissionInfo {
        bool anyoneTrade;                               // Boolean indicating if anyone can execute a trade
        address[] tradersHistory;                       // Tracks permissioned traders to be deleted on module removal
        mapping(address => bool) tradeAllowList;        // Mapping indicating which addresses are allowed to execute trade
    }

    struct RebalanceInfo {
        uint256 positionMultiplier;         // Position multiplier at the beginning of rebalance
        uint256 raiseTargetPercentage;      // Amount to raise all unit targets by if allowed (in precise units)
        address[] rebalanceComponents;      // Array of components involved in rebalance
    }

    struct TradeInfo {
        ICKToken ckToken;                           // Instance of CKToken
        IIndexExchangeAdapter exchangeAdapter;      // Instance of Exchange Adapter
        address sendToken;                          // Address of token being sold
        address receiveToken;                       // Address of token being bought
        bool isSendTokenFixed;                      // Boolean indicating fixed asset is send token
        uint256 ckTotalSupply;                     // Total supply of CK (in precise units)
        uint256 totalFixedQuantity;                 // Total quantity of fixed asset being traded
        uint256 sendQuantity;                       // Units of component sent to the exchange
        uint256 floatingQuantityLimit;              // Max/min amount of floating token spent/received during trade
        uint256 preTradeSendTokenBalance;           // Total initial balance of token being sold
        uint256 preTradeReceiveTokenBalance;        // Total initial balance of token being bought
        bytes exchangeData;                         // Arbitrary data for executing trade on given exchange
    }

    /* ============ Events ============ */

    event TargetUnitsUpdated(ICKToken indexed _ckToken, address indexed _component, uint256 _newUnit, uint256 _positionMultiplier);
    event TradeMaximumUpdated(ICKToken indexed _ckToken, address indexed _component, uint256 _newMaximum);
    event AssetExchangeUpdated(ICKToken indexed _ckToken, address indexed _component, string _newExchangeName);
    event CoolOffPeriodUpdated(ICKToken indexed _ckToken, address indexed _component, uint256 _newCoolOffPeriod);
    event ExchangeDataUpdated(ICKToken indexed _ckToken, address indexed _component, bytes _newExchangeData);
    event RaiseTargetPercentageUpdated(ICKToken indexed _ckToken, uint256 indexed _raiseTargetPercentage);
    event AssetTargetsRaised(ICKToken indexed _ckToken, uint256 indexed positionMultiplier);

    event AnyoneTradeUpdated(ICKToken indexed _ckToken, bool indexed _status);
    event TraderStatusUpdated(ICKToken indexed _ckToken, address indexed _trader, bool _status);

    event TradeExecuted(
        ICKToken indexed _ckToken,
        address indexed _sellComponent,
        address indexed _buyComponent,
        IIndexExchangeAdapter _exchangeAdapter,
        address _executor,
        uint256 _netAmountSold,
        uint256 _netAmountReceived,
        uint256 _protocolFee
    );

    event RebalanceStarted(ICKToken indexed _ckToken);

    /* ============ Constants ============ */

    uint256 private constant GENERAL_INDEX_MODULE_PROTOCOL_FEE_INDEX = 0;                  // Id of protocol fee % assigned to this module in the Controller

    /* ============ State Variables ============ */

    mapping(ICKToken => mapping(IERC20 => TradeExecutionParams)) public executionInfo;     // Mapping of CKToken to execution parameters of each asset on CKToken
    mapping(ICKToken => TradePermissionInfo) public permissionInfo;                        // Mapping of CKToken to trading permissions
    mapping(ICKToken => RebalanceInfo) public rebalanceInfo;                               // Mapping of CKToken to relevant data for current rebalance
    IWETH public immutable weth;                                                           // Weth contract address

    /* ============ Modifiers ============ */

    modifier onlyAllowedTrader(ICKToken _ckToken) {
        _validateOnlyAllowedTrader(_ckToken);
        _;
    }

    modifier onlyEOAIfUnrestricted(ICKToken _ckToken) {
        _validateOnlyEOAIfUnrestricted(_ckToken);
        _;
    }

    /* ============ Constructor ============ */

    constructor(IController _controller, IWETH _weth) public ModuleBase(_controller) {
        weth = _weth;
    }

    /* ============ External Functions ============ */

    /**
     * MANAGER ONLY: Changes the target allocation of the CK, opening it up for trading by the CKs designated traders. The manager
     * must pass in any new components and their target units (units defined by the amount of that component the manager wants in 10**18
     * units of a CKToken). Old component target units must be passed in, in the current order of the components array on the
     * CKToken. If a component is being removed it's index in the _oldComponentsTargetUnits should be set to 0. Additionally, the
     * positionMultiplier is passed in, in order to adjust the target units in the event fees are accrued or some other activity occurs
     * that changes the positionMultiplier of the CK. This guarantees the same relative allocation between all the components.
     *
     * @param _ckToken                          Address of the CKToken to be rebalanced
     * @param _newComponents                    Array of new components to add to allocation
     * @param _newComponentsTargetUnits         Array of target units at end of rebalance for new components, maps to same index of _newComponents array
     * @param _oldComponentsTargetUnits         Array of target units at end of rebalance for old component, maps to same index of
     *                                               _ckToken.getComponents() array, if component being removed set to 0.
     * @param _positionMultiplier               Position multiplier when target units were calculated, needed in order to adjust target units
     *                                               if fees accrued
     */
    function startRebalance(
        ICKToken _ckToken,
        address[] calldata _newComponents,
        uint256[] calldata _newComponentsTargetUnits,
        uint256[] calldata _oldComponentsTargetUnits,
        uint256 _positionMultiplier
    )
        external
        onlyManagerAndValidCK(_ckToken)
    {
        ( address[] memory aggregateComponents, uint256[] memory aggregateTargetUnits ) = _getAggregateComponentsAndUnits(
            _ckToken.getComponents(),
            _newComponents,
            _newComponentsTargetUnits,
            _oldComponentsTargetUnits
        );

        for (uint256 i = 0; i < aggregateComponents.length; i++) {
            require(
                _ckToken.getExternalPositionModules(aggregateComponents[i]).length == 0,
                "External positions not allowed"
            );

            executionInfo[_ckToken][IERC20(aggregateComponents[i])].targetUnit = aggregateTargetUnits[i];
            emit TargetUnitsUpdated(_ckToken, aggregateComponents[i], aggregateTargetUnits[i], _positionMultiplier);
        }

        rebalanceInfo[_ckToken].rebalanceComponents = aggregateComponents;
        rebalanceInfo[_ckToken].positionMultiplier = _positionMultiplier;

        emit RebalanceStarted(_ckToken);
    }

    /**
     * ACCESS LIMITED: Calling trade() pushes the current component units closer to the target units defined by the manager in startRebalance().
     * Only approved addresses can call, if anyoneTrade is false then contracts are allowed to call otherwise calling address must be EOA.
     *
     * Trade can be called at anytime but will revert if the passed component's target unit is met or cool off period hasn't passed. Trader can pass
     * in a max/min amount of ETH spent/received in the trade based on if the component is being bought/sold in order to prevent sandwich attacks.
     * The parameters defined by the manager are used to determine which exchange will be used and the size of the trade. Trade size will default
     * to max trade size unless the max trade size would exceed the target, then an amount that would match the target unit is traded. Protocol fees,
     * if enabled, are collected in the token received in a trade.
     *
     * @param _ckToken              Address of the CKToken
     * @param _component            Address of CKToken component to trade
     * @param _ethQuantityLimit     Max/min amount of ETH spent/received during trade
     */
    function trade(
        ICKToken _ckToken,
        IERC20 _component,
        uint256 _ethQuantityLimit
    )
        external
        nonReentrant
        onlyAllowedTrader(_ckToken)
        onlyEOAIfUnrestricted(_ckToken)
        virtual
    {
        _validateTradeParameters(_ckToken, _component);

        TradeInfo memory tradeInfo = _createTradeInfo(_ckToken, _component, _ethQuantityLimit);

        _executeTrade(tradeInfo);

        uint256 protocolFee = _accrueProtocolFee(tradeInfo);
        (uint256 netSendAmount, uint256 netReceiveAmount) = _updatePositionStateAndTimestamp(tradeInfo, _component);

        emit TradeExecuted(
            tradeInfo.ckToken,
            tradeInfo.sendToken,
            tradeInfo.receiveToken,
            tradeInfo.exchangeAdapter,
            msg.sender,
            netSendAmount,
            netReceiveAmount,
            protocolFee
        );
    }

    /**
     * ACCESS LIMITED: Only callable when 1) there are no more components to be sold and, 2) entire remaining WETH amount (above WETH target) can be
     * traded such that resulting inflows won't exceed component's maxTradeSize nor overshoot the target unit. To be used near the end of rebalances
     * when a component's calculated trade size is greater in value than remaining WETH.
     *
     * Only approved addresses can call, if anyoneTrade is false then contracts are allowed to call otherwise calling address must be EOA. Trade
     * can be called at anytime but will revert if the passed component's target unit is met or cool off period hasn't passed. Like with trade()
     * a minimum component receive amount can be set.
     *
     * @param _ckToken                      Address of the CKToken
     * @param _component                    Address of the CKToken component to trade
     * @param _minComponentReceived         Min amount of component received during trade
     */
    function tradeRemainingWETH(
        ICKToken _ckToken,
        IERC20 _component,
        uint256 _minComponentReceived
    )
        external
        nonReentrant
        onlyAllowedTrader(_ckToken)
        onlyEOAIfUnrestricted(_ckToken)
        virtual
    {
        require(_noTokensToSell(_ckToken), "Sell other ck components first");
        require(
            executionInfo[_ckToken][weth].targetUnit < _getDefaultPositionRealUnit(_ckToken, weth),
            "WETH is below target unit"
        );

        _validateTradeParameters(_ckToken, _component);

        TradeInfo memory tradeInfo = _createTradeRemainingInfo(_ckToken, _component, _minComponentReceived);

        _executeTrade(tradeInfo);

        uint256 protocolFee = _accrueProtocolFee(tradeInfo);
        (uint256 netSendAmount, uint256 netReceiveAmount) = _updatePositionStateAndTimestamp(tradeInfo, _component);

        require(
            netReceiveAmount.add(protocolFee) < executionInfo[_ckToken][_component].maxSize,
            "Trade amount > max trade size"
        );

        _validateComponentPositionUnit(_ckToken, _component);

        emit TradeExecuted(
            tradeInfo.ckToken,
            tradeInfo.sendToken,
            tradeInfo.receiveToken,
            tradeInfo.exchangeAdapter,
            msg.sender,
            netSendAmount,
            netReceiveAmount,
            protocolFee
        );
    }

    /**
     * ACCESS LIMITED: For situation where all target units met and remaining WETH, uniformly raise targets by same percentage by applying
     * to logged positionMultiplier in RebalanceInfo struct, in order to allow further trading. Can be called multiple times if necessary,
     * targets are increased by amount specified by raiseAssetTargetsPercentage as ck by manager. In order to reduce tracking error
     * raising the target by a smaller amount allows greater granularity in finding an equilibrium between the excess ETH and components
     * that need to be bought. Raising the targets too much could result in vastly under allocating to WETH as more WETH than necessary is
     * spent buying the components to meet their new target.
     *
     * @param _ckToken             Address of the CKToken
     */
    function raiseAssetTargets(ICKToken _ckToken) external onlyAllowedTrader(_ckToken) virtual {
        require(
            _allTargetsMet(_ckToken)
            && _getDefaultPositionRealUnit(_ckToken, weth) > _getNormalizedTargetUnit(_ckToken, weth),
            "Targets not met or ETH =~ 0"
        );

        // positionMultiplier / (10^18 + raiseTargetPercentage)
        // ex: (10 ** 18) / ((10 ** 18) + ether(.0025)) => 997506234413965087
        rebalanceInfo[_ckToken].positionMultiplier = rebalanceInfo[_ckToken].positionMultiplier.preciseDiv(
            PreciseUnitMath.preciseUnit().add(rebalanceInfo[_ckToken].raiseTargetPercentage)
        );
        emit AssetTargetsRaised(_ckToken, rebalanceInfo[_ckToken].positionMultiplier);
    }

    /**
     * MANAGER ONLY: Set trade maximums for passed components of the CKToken. Can be called at anytime.
     * Note: Trade maximums must be set before rebalance can begin properly - they are zero by
     * default and trades will not execute if a component's trade size is greater than the maximum.
     *
     * @param _ckToken             Address of the CKToken
     * @param _components           Array of components
     * @param _tradeMaximums        Array of trade maximums mapping to correct component
     */
    function setTradeMaximums(
        ICKToken _ckToken,
        address[] memory _components,
        uint256[] memory _tradeMaximums
    )
        external
        onlyManagerAndValidCK(_ckToken)
    {
        _components.validatePairsWithArray(_tradeMaximums);

        for (uint256 i = 0; i < _components.length; i++) {
            executionInfo[_ckToken][IERC20(_components[i])].maxSize = _tradeMaximums[i];
            emit TradeMaximumUpdated(_ckToken, _components[i], _tradeMaximums[i]);
        }
    }

    /**
     * MANAGER ONLY: Set exchange for passed components of the CKToken. Can be called at anytime.
     *
     * @param _ckToken              Address of the CKToken
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

                executionInfo[_ckToken][IERC20(_components[i])].exchangeName = _exchangeNames[i];
                emit AssetExchangeUpdated(_ckToken, _components[i], _exchangeNames[i]);
            }
        }
    }

    /**
     * MANAGER ONLY: Set cool off periods for passed components of the CKToken. Can be called at any time.
     *
     * @param _ckToken              Address of the CKToken
     * @param _components           Array of components
     * @param _coolOffPeriods       Array of cool off periods to correct component
     */
    function setCoolOffPeriods(
        ICKToken _ckToken,
        address[] memory _components,
        uint256[] memory _coolOffPeriods
    )
        external
        onlyManagerAndValidCK(_ckToken)
    {
        _components.validatePairsWithArray(_coolOffPeriods);

        for (uint256 i = 0; i < _components.length; i++) {
            executionInfo[_ckToken][IERC20(_components[i])].coolOffPeriod = _coolOffPeriods[i];
            emit CoolOffPeriodUpdated(_ckToken, _components[i], _coolOffPeriods[i]);
        }
    }

    /**
     * MANAGER ONLY: Set arbitrary byte data on a per asset basis that can be used to pass exchange specific settings (i.e. specifying
     * fee tiers) or exchange specific features (enabling multi-hop trades). Can be called at any time.
     *
     * @param _ckToken              Address of the CKToken
     * @param _components           Array of components
     * @param _exchangeData         Array of exchange specific arbitrary bytes data
     */
    function setExchangeData(
        ICKToken _ckToken,
        address[] memory _components,
        bytes[] memory _exchangeData
    )
        external
        onlyManagerAndValidCK(_ckToken)
    {
        _components.validatePairsWithArray(_exchangeData);

        for (uint256 i = 0; i < _components.length; i++) {
            executionInfo[_ckToken][IERC20(_components[i])].exchangeData = _exchangeData[i];
            emit ExchangeDataUpdated(_ckToken, _components[i], _exchangeData[i]);
        }
    }

    /**
     * MANAGER ONLY: Set amount by which all component's targets units would be raised. Can be called at any time.
     *
     * @param _ckToken                     Address of the CKToken
     * @param _raiseTargetPercentage        Amount to raise all component's unit targets by (in precise units)
     */
    function setRaiseTargetPercentage(
        ICKToken _ckToken,
        uint256 _raiseTargetPercentage
    )
        external
        onlyManagerAndValidCK(_ckToken)
    {
        require(_raiseTargetPercentage > 0, "Target percentage must be > 0");
        rebalanceInfo[_ckToken].raiseTargetPercentage = _raiseTargetPercentage;
        emit RaiseTargetPercentageUpdated(_ckToken, _raiseTargetPercentage);
    }

    /**
     * MANAGER ONLY: Toggles ability for passed addresses to call trade() or tradeRemainingWETH(). Can be called at any time.
     *
     * @param _ckToken          Address of the CKToken
     * @param _traders           Array trader addresses to toggle status
     * @param _statuses          Booleans indicating if matching trader can trade
     */
    function setTraderStatus(
        ICKToken _ckToken,
        address[] memory _traders,
        bool[] memory _statuses
    )
        external
        onlyManagerAndValidCK(_ckToken)
    {
        _traders.validatePairsWithArray(_statuses);

        for (uint256 i = 0; i < _traders.length; i++) {
            _updateTradersHistory(_ckToken, _traders[i], _statuses[i]);
            permissionInfo[_ckToken].tradeAllowList[_traders[i]] = _statuses[i];
            emit TraderStatusUpdated(_ckToken, _traders[i], _statuses[i]);
        }
    }

    /**
     * MANAGER ONLY: Toggle whether anyone can trade, if true bypasses the traderAllowList. Can be called at anytime.
     *
     * @param _ckToken         Address of the CKToken
     * @param _status           Boolean indicating if anyone can trade
     */
    function setAnyoneTrade(ICKToken _ckToken, bool _status) external onlyManagerAndValidCK(_ckToken) {
        permissionInfo[_ckToken].anyoneTrade = _status;
        emit AnyoneTradeUpdated(_ckToken, _status);
    }

    /**
     * MANAGER ONLY: Called to initialize module to CKToken in order to allow GeneralIndexModule access for rebalances.
     * Grabs the current units for each asset in the CK and CK's the targetUnit to that unit in order to prevent any
     * trading until startRebalance() is explicitly called. Position multiplier is also logged in order to make sure any
     * position multiplier changes don't unintentionally open the CK for rebalancing.
     *
     * @param _ckToken         Address of the CKToken
     */
    function initialize(ICKToken _ckToken)
        external
        onlyCKManager(_ckToken, msg.sender)
        onlyValidAndPendingCK(_ckToken)
    {
        ICKToken.Position[] memory positions = _ckToken.getPositions();

        for (uint256 i = 0; i < positions.length; i++) {
            ICKToken.Position memory position = positions[i];
            require(position.positionState == 0, "External positions not allowed");
            executionInfo[_ckToken][IERC20(position.component)].targetUnit = position.unit.toUint256();
            executionInfo[_ckToken][IERC20(position.component)].lastTradeTimestamp = 0;
        }

        rebalanceInfo[_ckToken].positionMultiplier = _ckToken.positionMultiplier().toUint256();
        _ckToken.initializeModule();
    }

    /**
     * Called by a CKToken to notify that this module was removed from the CKToken.
     * Clears the rebalanceInfo and permissionsInfo of the calling CKToken.
     * IMPORTANT: CKToken's execution settings, including trade maximums and exchange names,
     * are NOT DELETED. Restoring a previously removed module requires that care is taken to
     * initialize execution settings appropriately.
     */
    function removeModule() external override {
        TradePermissionInfo storage tokenPermissionInfo = permissionInfo[ICKToken(msg.sender)];

        for (uint i = 0; i < tokenPermissionInfo.tradersHistory.length; i++) {
            tokenPermissionInfo.tradeAllowList[tokenPermissionInfo.tradersHistory[i]] = false;
        }

        delete rebalanceInfo[ICKToken(msg.sender)];
        delete permissionInfo[ICKToken(msg.sender)];
    }

    /* ============ External View Functions ============ */

    /**
     * Get the array of CKToken components involved in rebalance.
     *
     * @param _ckToken          Address of the CKToken
     *
     * @return address[]        Array of _ckToken components involved in rebalance
     */
    function getRebalanceComponents(ICKToken _ckToken)
        external
        view
        onlyValidAndInitializedCK(_ckToken)
        returns (address[] memory)
    {
        return rebalanceInfo[_ckToken].rebalanceComponents;
    }

    /**
     * Calculates the amount of a component that is going to be traded and whether the component is being bought
     * or sold. If currentUnit and targetUnit are the same, function will revert.
     *
     * @param _ckToken                  Instance of the CKToken to rebalance
     * @param _component                IERC20 component to trade
     *
     * @return isSendTokenFixed         Boolean indicating fixed asset is send token
     * @return componentQuantity        Amount of component being traded
     */
    function getComponentTradeQuantityAndDirection(
        ICKToken _ckToken,
        IERC20 _component
    )
        external
        view
        onlyValidAndInitializedCK(_ckToken)
        returns (bool, uint256)
    {
        require(_ckToken.isComponent(address(_component)), "Component not recognized");
        uint256 totalSupply = _ckToken.totalSupply();
        return _calculateTradeSizeAndDirection(_ckToken, _component, totalSupply);
    }


    /**
     * Get if a given address is an allowed trader.
     *
     * @param _ckToken          Address of the CKToken
     * @param _trader           Address of the trader
     *
     * @return bool             True if _trader is allowed to trade, else false
     */
    function getIsAllowedTrader(ICKToken _ckToken, address _trader)
        external
        view
        onlyValidAndInitializedCK(_ckToken)
        returns (bool)
    {
        return _isAllowedTrader(_ckToken, _trader);
    }

    /**
     * Get the list of traders who are allowed to call trade(), tradeRemainingWeth(), and raiseAssetTarget()
     *
     * @param _ckToken         Address of the CKToken
     *
     * @return address[]
     */
    function getAllowedTraders(ICKToken _ckToken)
        external
        view
        onlyValidAndInitializedCK(_ckToken)
        returns (address[] memory)
    {
        return permissionInfo[_ckToken].tradersHistory;
    }

    /* ============ Internal Functions ============ */

    /**
     * Validate that component is a valid component and enough time has elapsed since component's last trade. Traders
     * cannot explicitly trade WETH, it may only implicitly be traded by being the quote asset for other component trades.
     *
     * @param _ckToken         Instance of the CKToken
     * @param _component        IERC20 component to be validated
     */
    function _validateTradeParameters(ICKToken _ckToken, IERC20 _component) internal view virtual {
        require(address(_component) != address(weth), "Can not explicitly trade WETH");
        require(
            rebalanceInfo[_ckToken].rebalanceComponents.contains(address(_component)),
            "Component not part of rebalance"
        );

        TradeExecutionParams memory componentInfo = executionInfo[_ckToken][_component];
        require(
            componentInfo.lastTradeTimestamp.add(componentInfo.coolOffPeriod) <= block.timestamp,
            "Component cool off in progress"
        );
    }

    /**
     * Create and return TradeInfo struct. This function reverts if the target has already been met.
     * If this is a trade from component into WETH, sell the total fixed component quantity
     * and expect to receive an ETH amount the user has specified (or more). If it's a trade from
     * WETH into a component, sell the lesser of: the user's WETH limit OR the CKToken's
     * remaining WETH balance and expect to receive a fixed component quantity.
     *
     * @param _ckToken              Instance of the CKToken to rebalance
     * @param _component            IERC20 component to trade
     * @param _ethQuantityLimit     Max/min amount of weth spent/received during trade
     *
     * @return tradeInfo            Struct containing data for trade
     */
    function _createTradeInfo(
        ICKToken _ckToken,
        IERC20 _component,
        uint256 _ethQuantityLimit
    )
        internal
        view
        virtual
        returns (TradeInfo memory tradeInfo)
    {
        tradeInfo = _getDefaultTradeInfo(_ckToken, _component, true);

        if (tradeInfo.isSendTokenFixed){
            tradeInfo.sendQuantity = tradeInfo.totalFixedQuantity;
            tradeInfo.floatingQuantityLimit = _ethQuantityLimit;
        } else {
            tradeInfo.sendQuantity = _ethQuantityLimit.min(tradeInfo.preTradeSendTokenBalance);
            tradeInfo.floatingQuantityLimit = tradeInfo.totalFixedQuantity;
        }
    }

    /**
     * Create and return TradeInfo struct. This function does NOT check if the WETH target has been met.
     *
     * @param _ckToken                      Instance of the CKToken to rebalance
     * @param _component                    IERC20 component to trade
     * @param _minComponentReceived         Min amount of component received during trade
     *
     * @return tradeInfo                    Struct containing data for tradeRemaining info
     */
    function _createTradeRemainingInfo(
        ICKToken _ckToken,
        IERC20 _component,
        uint256 _minComponentReceived
    )
        internal
        view
        returns (TradeInfo memory tradeInfo)
    {
        tradeInfo = _getDefaultTradeInfo(_ckToken, _component, false);

        (,,
            uint256 currentNotional,
            uint256 targetNotional
        ) = _getUnitsAndNotionalAmounts(_ckToken, weth, tradeInfo.ckTotalSupply);

        tradeInfo.sendQuantity =  currentNotional.sub(targetNotional);
        tradeInfo.floatingQuantityLimit = _minComponentReceived;
        tradeInfo.isSendTokenFixed = true;
    }

    /**
     * Create and returns a partial TradeInfo struct with all fields that overlap between `trade`
     * and `tradeRemaining` info constructors filled in. Values for `sendQuantity` and `floatingQuantityLimit`
     * are derived separately, outside this method. `trade` requires that trade size and direction are
     * calculated, whereas `tradeRemaining` automatically sets WETH as the sendToken and _component
     * as receiveToken.
     *
     * @param _ckToken                      Instance of the CKToken to rebalance
     * @param _component                    IERC20 component to trade
     * @param  calculateTradeDirection      Indicates whether method should calculate trade size and direction
     *
     * @return tradeInfo                    Struct containing partial data for trade
     */
    function _getDefaultTradeInfo(ICKToken _ckToken, IERC20 _component, bool calculateTradeDirection)
        internal
        view
        returns (TradeInfo memory tradeInfo)
    {
        tradeInfo.ckToken = _ckToken;
        tradeInfo.ckTotalSupply = _ckToken.totalSupply();
        tradeInfo.exchangeAdapter = _getExchangeAdapter(_ckToken, _component);
        tradeInfo.exchangeData = executionInfo[_ckToken][_component].exchangeData;

        if(calculateTradeDirection){
            (
                tradeInfo.isSendTokenFixed,
                tradeInfo.totalFixedQuantity
            ) = _calculateTradeSizeAndDirection(_ckToken, _component, tradeInfo.ckTotalSupply);
        }

        if (tradeInfo.isSendTokenFixed){
            tradeInfo.sendToken = address(_component);
            tradeInfo.receiveToken = address(weth);
        } else {
            tradeInfo.sendToken = address(weth);
            tradeInfo.receiveToken = address(_component);
        }

        tradeInfo.preTradeSendTokenBalance = IERC20(tradeInfo.sendToken).balanceOf(address(_ckToken));
        tradeInfo.preTradeReceiveTokenBalance = IERC20(tradeInfo.receiveToken).balanceOf(address(_ckToken));
    }

    /**
     * Function handles all interactions with exchange. All GeneralIndexModule adapters must allow for selling or buying a fixed
     * quantity of a token in return for a non-fixed (floating) quantity of a token. If `isSendTokenFixed` is true then the adapter
     * will choose the exchange interface associated with inputting a fixed amount, otherwise it will select the interface used for
     * receiving a fixed amount. Any other exchange specific data can also be created by calling generateDataParam function.
     *
     * @param _tradeInfo            Struct containing trade information used in internal functions
     */
    function _executeTrade(TradeInfo memory _tradeInfo) internal virtual {
        _tradeInfo.ckToken.invokeApprove(
            _tradeInfo.sendToken,
            _tradeInfo.exchangeAdapter.getSpender(),
            _tradeInfo.sendQuantity
        );

        (
            address targetExchange,
            uint256 callValue,
            bytes memory methodData
        ) = _tradeInfo.exchangeAdapter.getTradeCalldata(
            _tradeInfo.sendToken,
            _tradeInfo.receiveToken,
            address(_tradeInfo.ckToken),
            _tradeInfo.isSendTokenFixed,
            _tradeInfo.sendQuantity,
            _tradeInfo.floatingQuantityLimit,
            _tradeInfo.exchangeData
        );

        _tradeInfo.ckToken.invoke(targetExchange, callValue, methodData);
    }

    /**
     * Retrieve fee from controller and calculate total protocol fee and send from CKToken to protocol recipient.
     * The protocol fee is collected from the amount of received token in the trade.
     *
     * @param _tradeInfo                Struct containing trade information used in internal functions
     *
     * @return protocolFee              Amount of receive token taken as protocol fee
     */
    function _accrueProtocolFee(TradeInfo memory _tradeInfo) internal returns (uint256 protocolFee) {
        uint256 exchangedQuantity =  IERC20(_tradeInfo.receiveToken)
            .balanceOf(address(_tradeInfo.ckToken))
            .sub(_tradeInfo.preTradeReceiveTokenBalance);

        protocolFee = getModuleFee(GENERAL_INDEX_MODULE_PROTOCOL_FEE_INDEX, exchangedQuantity);
        payProtocolFeeFromCKToken(_tradeInfo.ckToken, _tradeInfo.receiveToken, protocolFee);
    }

    /**
     * Update CKToken positions and executionInfo's last trade timestamp. This function is intended
     * to be called after the fees have been accrued, hence it returns the amount of tokens bought net of fees.
     *
     * @param _tradeInfo                Struct containing trade information used in internal functions
     * @param _component                IERC20 component which was traded
     *
     * @return netSendAmount            Amount of sendTokens used in the trade
     * @return netReceiveAmount         Amount of receiveTokens received in the trade (net of fees)
     */
    function _updatePositionStateAndTimestamp(TradeInfo memory _tradeInfo, IERC20 _component)
        internal
        returns (uint256 netSendAmount, uint256 netReceiveAmount)
    {
        (uint256 postTradeSendTokenBalance,,) = _tradeInfo.ckToken.calculateAndEditDefaultPosition(
            _tradeInfo.sendToken,
            _tradeInfo.ckTotalSupply,
            _tradeInfo.preTradeSendTokenBalance
        );
        (uint256 postTradeReceiveTokenBalance,,) = _tradeInfo.ckToken.calculateAndEditDefaultPosition(
            _tradeInfo.receiveToken,
            _tradeInfo.ckTotalSupply,
            _tradeInfo.preTradeReceiveTokenBalance
        );

        netSendAmount = _tradeInfo.preTradeSendTokenBalance.sub(postTradeSendTokenBalance);
        netReceiveAmount = postTradeReceiveTokenBalance.sub(_tradeInfo.preTradeReceiveTokenBalance);

        executionInfo[_tradeInfo.ckToken][_component].lastTradeTimestamp = block.timestamp;
    }

    /**
     * Calculates the amount of a component is going to be traded and whether the component is being bought or sold.
     * If currentUnit and targetUnit are the same, function will revert.
     *
     * @param _ckToken                 Instance of the CKToken to rebalance
     * @param _component                IERC20 component to trade
     * @param _totalSupply              Total supply of _ckToken
     *
     * @return isSendTokenFixed         Boolean indicating fixed asset is send token
     * @return totalFixedQuantity       Amount of fixed token to send or receive
     */
    function _calculateTradeSizeAndDirection(
        ICKToken _ckToken,
        IERC20 _component,
        uint256 _totalSupply
    )
        internal
        view
        returns (bool isSendTokenFixed, uint256 totalFixedQuantity)
    {
        uint256 protocolFee = controller.getModuleFee(address(this), GENERAL_INDEX_MODULE_PROTOCOL_FEE_INDEX);
        uint256 componentMaxSize = executionInfo[_ckToken][_component].maxSize;

        (
            uint256 currentUnit,
            uint256 targetUnit,
            uint256 currentNotional,
            uint256 targetNotional
        ) = _getUnitsAndNotionalAmounts(_ckToken, _component, _totalSupply);

        require(currentUnit != targetUnit, "Target already met");

        isSendTokenFixed = targetNotional < currentNotional;

        // In order to account for fees taken by protocol when buying the notional difference between currentUnit
        // and targetUnit is divided by (1 - protocolFee) to make sure that targetUnit can be met. Failure to
        // do so would lead to never being able to meet target of components that need to be bought.
        //
        // ? - lesserOf: (componentMaxSize, (currentNotional - targetNotional))
        // : - lesserOf: (componentMaxSize, (targetNotional - currentNotional) / 10 ** 18 - protocolFee)
        totalFixedQuantity = isSendTokenFixed
            ? componentMaxSize.min(currentNotional.sub(targetNotional))
            : componentMaxSize.min(targetNotional.sub(currentNotional).preciseDiv(PreciseUnitMath.preciseUnit().sub(protocolFee)));
    }

    /**
     * Gets unit and notional amount values for current position and target. These are necessary
     * to calculate the trade size and direction for regular trades and the `sendQuantity` for
     * remainingWEth trades.
     *
     * @param _ckToken                 Instance of the CKToken to rebalance
     * @param _component                IERC20 component to calculate notional amounts for
     * @param _totalSupply              CKToken total supply
     *
     * @return uint256              Current default position real unit of component
     * @return uint256              Normalized unit of the trade target
     * @return uint256              Current notional amount: total notional amount of CKToken default position
     * @return uint256              Target notional amount: Total CKToken supply * targetUnit
     */
    function _getUnitsAndNotionalAmounts(ICKToken _ckToken, IERC20 _component, uint256 _totalSupply)
        internal
        view
        returns (uint256, uint256, uint256, uint256)
    {
        uint256 currentUnit = _getDefaultPositionRealUnit(_ckToken, _component);
        uint256 targetUnit = _getNormalizedTargetUnit(_ckToken, _component);

        return (
            currentUnit,
            targetUnit,
            _totalSupply.getDefaultTotalNotional(currentUnit),
            _totalSupply.preciseMulCeil(targetUnit)
        );
    }

    /**
     * Check if there are any more tokens to sell. Since we allow WETH to float around it's target during rebalances it is not checked.
     *
     * @param _ckToken             Instance of the CKToken to be rebalanced
     *
     * @return bool                 True if there is not any component that can be sold, otherwise false
     */
    function _noTokensToSell(ICKToken _ckToken) internal view returns (bool) {
        address[] memory rebalanceComponents = rebalanceInfo[_ckToken].rebalanceComponents;

        for (uint256 i = 0; i < rebalanceComponents.length; i++) {
            if (_canSell(_ckToken, rebalanceComponents[i]) ) { return false; }
        }
        return true;
    }

    /**
     * Check if all targets are met.
     *
     * @param _ckToken             Instance of the CKToken to be rebalanced
     *
     * @return bool                 True if all component's target units have been met, otherwise false
     */
    function _allTargetsMet(ICKToken _ckToken) internal view returns (bool) {
        address[] memory rebalanceComponents = rebalanceInfo[_ckToken].rebalanceComponents;

        for (uint256 i = 0; i < rebalanceComponents.length; i++) {
            if (_targetUnmet(_ckToken, rebalanceComponents[i])) { return false; }
        }
        return true;
    }

    /**
     * Calculates and returns the normalized target unit value.
     *
     * @param _ckToken             Instance of the CKToken to be rebalanced
     * @param _component            IERC20 component whose normalized target unit is required
     *
     * @return uint256                          Normalized target unit of the component
     */
    function _getNormalizedTargetUnit(ICKToken _ckToken, IERC20 _component) internal view returns(uint256) {
        // (targetUnit * current position multiplier) / position multiplier when rebalance started
        return executionInfo[_ckToken][_component]
            .targetUnit
            .mul(_ckToken.positionMultiplier().toUint256())
            .div(rebalanceInfo[_ckToken].positionMultiplier);
    }

    /**
     * Gets exchange adapter address for a component after checking that it exists in the
     * IntegrationRegistry. This method is called during a trade and must validate the adapter
     * because its state may have changed since it was set in a separate transaction.
     *
     * @param _ckToken                         Instance of the CKToken to be rebalanced
     * @param _component                        IERC20 component whose exchange adapter is fetched
     *
     * @return IExchangeAdapter                 Adapter address
     */
    function _getExchangeAdapter(ICKToken _ckToken, IERC20 _component) internal view returns(IIndexExchangeAdapter) {
        return IIndexExchangeAdapter(getAndValidateAdapter(executionInfo[_ckToken][_component].exchangeName));
    }

    /**
     * Extends and/or updates the current component set and its target units with new components and targets,
     * Validates inputs, requiring that that new components and new target units arrays are the same size, and
     * that the number of old components target units matches the number of current components. Throws if
     * a duplicate component has been added.
     *
     * @param  _currentComponents               Complete set of current CKToken components
     * @param _newComponents                    Array of new components to add to allocation
     * @param _newComponentsTargetUnits         Array of target units at end of rebalance for new components, maps to same index of _newComponents array
     * @param _oldComponentsTargetUnits         Array of target units at end of rebalance for old component, maps to same index of
     *                                               _ckToken.getComponents() array, if component being removed set to 0.
     *
     * @return aggregateComponents              Array of current components extended by new components, without duplicates
     * @return aggregateTargetUnits             Array of old component target units extended by new target units, without duplicates
     */
    function _getAggregateComponentsAndUnits(
        address[] memory _currentComponents,
        address[] calldata _newComponents,
        uint256[] calldata _newComponentsTargetUnits,
        uint256[] calldata _oldComponentsTargetUnits
    )
        internal
        pure
        returns (address[] memory aggregateComponents, uint256[] memory aggregateTargetUnits)
    {
        // Don't use validate arrays because empty arrays are valid
        require(_newComponents.length == _newComponentsTargetUnits.length, "Array length mismatch");
        require(_currentComponents.length == _oldComponentsTargetUnits.length, "Old Components targets missing");

        aggregateComponents = _currentComponents.extend(_newComponents);
        aggregateTargetUnits = _oldComponentsTargetUnits.extend(_newComponentsTargetUnits);

        require(!aggregateComponents.hasDuplicate(), "Cannot duplicate components");
    }

    /**
     * Validate component position unit has not exceeded it's target unit. This is used during tradeRemainingWETH() to make sure
     * the amount of component bought does not exceed the targetUnit.
     *
     * @param _ckToken         Instance of the CKToken
     * @param _component        IERC20 component whose position units are to be validated
     */
    function _validateComponentPositionUnit(ICKToken _ckToken, IERC20 _component) internal view {
        uint256 currentUnit = _getDefaultPositionRealUnit(_ckToken, _component);
        uint256 targetUnit = _getNormalizedTargetUnit(_ckToken, _component);
        require(currentUnit <= targetUnit, "Can not exceed target unit");
    }

    /**
     * Get the CKToken's default position as uint256
     *
     * @param _ckToken         Instance of the CKToken
     * @param _component        IERC20 component to fetch the default position for
     *
     * return uint256           Real unit position
     */
    function _getDefaultPositionRealUnit(ICKToken _ckToken, IERC20 _component) internal view returns (uint256) {
        return _ckToken.getDefaultPositionRealUnit(address(_component)).toUint256();
    }

    /**
     * Determine if passed address is allowed to call trade for the CKToken. If anyoneTrade set to true anyone can call otherwise
     * needs to be approved.
     *
     * @param _ckToken             Instance of CKToken to be rebalanced
     * @param  _trader              Address of the trader who called contract function
     *
     * @return bool                 True if trader is an approved trader for the CKToken
     */
    function _isAllowedTrader(ICKToken _ckToken, address _trader) internal view returns (bool) {
        TradePermissionInfo storage permissions = permissionInfo[_ckToken];
        return permissions.anyoneTrade || permissions.tradeAllowList[_trader];
    }

    /**
     * Checks if sell conditions are met. The component cannot be WETH and its normalized target
     * unit must be less than its default position real unit
     *
     * @param _ckToken                         Instance of the CKToken to be rebalanced
     * @param _component                        Component evaluated for sale
     *
     * @return bool                             True if sell allowed, false otherwise
     */
    function _canSell(ICKToken _ckToken, address _component) internal view returns(bool) {
        return (
            _component != address(weth) &&
            (
                _getNormalizedTargetUnit(_ckToken, IERC20(_component)) <
                _getDefaultPositionRealUnit(_ckToken,IERC20(_component))
            )
        );
    }

    /**
     * Determines if a target is met. Due to small rounding errors converting between virtual and
     * real unit on CKToken we allow for a 1 wei buffer when checking if target is met. In order to
     * avoid subtraction overflow errors targetUnits of zero check for an exact amount. WETH is not
     * checked as it is allowed to float around its target.
     *
     * @param _ckToken                         Instance of the CKToken to be rebalanced
     * @param _component                        Component whose target is evaluated
     *
     * @return bool                             True if component's target units are met, false otherwise
     */
    function _targetUnmet(ICKToken _ckToken, address _component) internal view returns(bool) {
        if (_component == address(weth)) return false;

        uint256 normalizedTargetUnit = _getNormalizedTargetUnit(_ckToken, IERC20(_component));
        uint256 currentUnit = _getDefaultPositionRealUnit(_ckToken, IERC20(_component));

        return (normalizedTargetUnit > 0)
            ? !(normalizedTargetUnit.approximatelyEquals(currentUnit, 1))
            : normalizedTargetUnit != currentUnit;
    }

    /**
     * Adds or removes newly permissioned trader to/from permissionsInfo traderHistory. It's
     * necessary to verify that traderHistory contains the address because AddressArrayUtils will
     * throw when attempting to remove a non-element and it's possible someone can set a new
     * trader's status to false.
     *
     * @param _ckToken                         Instance of the CKToken
     * @param _trader                           Trader whose permission is being set
     * @param _status                           Boolean permission being set
     */
    function _updateTradersHistory(ICKToken _ckToken, address _trader, bool _status) internal {
        if (_status && !permissionInfo[_ckToken].tradersHistory.contains(_trader)) {
            permissionInfo[_ckToken].tradersHistory.push(_trader);
        } else if(!_status && permissionInfo[_ckToken].tradersHistory.contains(_trader)) {
            permissionInfo[_ckToken].tradersHistory.removeStorage(_trader);
        }
    }

    /* ============== Modifier Helpers ===============
     * Internal functions used to reduce bytecode size
     */

    /*
     * Trader must be permissioned for CKToken
     */
    function _validateOnlyAllowedTrader(ICKToken _ckToken) internal view {
        require(_isAllowedTrader(_ckToken, msg.sender), "Address not permitted to trade");
    }

    /*
     * Trade must be an EOA if `anyoneTrade` has been enabled for CKToken on the module.
     */
    function _validateOnlyEOAIfUnrestricted(ICKToken _ckToken) internal view {
        if(permissionInfo[_ckToken].anyoneTrade) {
            require(msg.sender == tx.origin, "Caller must be EOA Address");
        }
    }
}
