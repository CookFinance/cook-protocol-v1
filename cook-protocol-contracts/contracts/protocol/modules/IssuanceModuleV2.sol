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
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
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
import { IWETH } from "../../interfaces/external/IWETH.sol";
import { IWrapAdapter } from "../../interfaces/IWrapAdapter.sol";
import { ModuleBase } from "../lib/ModuleBase.sol";
import { Position } from "../lib/Position.sol";
import { PreciseUnitMath } from "../../lib/PreciseUnitMath.sol";
import { IExchangeAdapter } from "../../interfaces/IExchangeAdapter.sol";
import { ResourceIdentifier } from "../lib/ResourceIdentifier.sol";
import { IYieldYakStrategyV2 } from "../../interfaces/external/IYieldYakStrategyV2.sol";

import "hardhat/console.sol";

/**
 * @title IssuanceModule
 * @author Cook Finance
 *
 * The IssuanceModule is a module that enables users to issue and redeem CKTokens that contain default and 
 * non-debt external Positions. Managers are able to set an external contract hook that is called before an
 * issuance is called.
 */
contract IssuanceModuleV2 is Ownable, ModuleBase, ReentrancyGuard {
    using AddressArrayUtils for address[];
    using Invoke for ICKToken;
    using Position for ICKToken;
    using Position for uint256;
    using PreciseUnitMath for uint256;
    using ResourceIdentifier for IController;
    using SafeMath for uint256;
    using SafeCast for int256;
    using SignedSafeMath for int256;

    /* ============ Struct ============ */
    struct WrapExecutionParams {
        string wrapAdapterName;     // Wrap adapter name
        address underlyingToken;    // Underlying token address of the wrapped token, ex. WETH is the underlying token of the aETH. This will be passed to wrap adapter to get wrap/unwrap call data
    }

    struct TradeInfo {
        ICKToken ckToken;                               // Instance of CKToken
        IExchangeAdapter exchangeAdapter;               // Instance of exchange adapter contract
        address sendToken;                              // Address of token being sold
        address receiveToken;                           // Address of token being bought
        uint256 totalSendQuantity;                      // Total quantity of sold token
        uint256 totalReceiveQuantity;                   // Total quantity of token to receive back
        uint256 preTradeSendTokenBalance;               // Total initial balance of token being sold
        uint256 preTradeReceiveTokenBalance;            // Total initial balance of token being bought
        bytes data;                                     // Arbitrary data
    }

    /* ============ Events ============ */

    event CKTokenIssued(address indexed _ckToken, address _issuer, address _to, address _hookContract, uint256 _ckMintQuantity, uint256 _issuedTokenReturned);
    event CKTokenRedeemed(address indexed _ckToken, address _redeemer, address _to, uint256 _quantity);
    event AssetExchangeExecutionParamUpdated(address indexed _component, string _newExchangeName);
    event AssetWrapExecutionParamUpdated(address indexed _component, string _newWrapAdapterName, address _newUnderlyingToken);
    event ComponentExchanged(
        ICKToken indexed _ckToken,
        address indexed _sendToken,
        address indexed _receiveToken,
        IExchangeAdapter _exchangeAdapter,
        uint256 _totalSendAmount,
        uint256 _totalReceiveAmount
    );
    event ComponentWrapped(
        ICKToken indexed _ckToken,
        address indexed _underlyingToken,
        address indexed _wrappedToken,
        uint256 _underlyingQuantity,
        uint256 _wrappedQuantity,
        string _integrationName
    );
    event ComponentUnwrapped(
        ICKToken indexed _ckToken,
        address indexed _underlyingToken,
        address indexed _wrappedToken,
        uint256 _underlyingQuantity,
        uint256 _wrappedQuantity,
        string _integrationName
    );

    /* ============ State Variables ============ */

    // Mapping of CKToken to Issuance hook configurations
    mapping(ICKToken => IManagerIssuanceHook) public managerIssuanceHook;
    // Mapping of asset to exchange execution parameters
    mapping(IERC20 => string) public exchangeInfo;
    // Mapping of asset to wrap execution parameters
    mapping(IERC20 => WrapExecutionParams) public wrapInfo;
    // Wrapped ETH address
    IWETH public immutable weth;

    /* ============ Constructor ============ */

    /**
     * Set state controller state variable
     */
    constructor(IController _controller, IWETH _weth) public ModuleBase(_controller) {
        weth = _weth;
    }

    /* ============ External Functions ============ */

    /**
     * Issue ckToken with a specified amount of Eth. 
     *
     * @param _ckToken              Instance of the CKToken contract
     * @param _minCkTokenRec        The minimum amount of CKToken to receive
     * @param _midTokens            The mid tokens in swap route
     * @param _weightings           Eth distribution for each component
     * @param _to                   Address to mint CKToken to
     * @param _returnDust           If to return left components
     */
    function issueWithEther2 (
        ICKToken _ckToken,
        uint256 _minCkTokenRec,
        address[] memory _midTokens,
        uint256[] memory _weightings,
        address _to,
        bool _returnDust
    )         
        external
        payable
        nonReentrant
        onlyValidAndInitializedCK(_ckToken) 
    {
        require(msg.value > 0, "Issue ether quantity must be > 0");
        weth.deposit{ value: msg.value }();
        // Transfer the specified weth to ckToken
        transferFrom(
            weth,
            address(this),
            address(_ckToken),
            msg.value
        );
        uint256 issueTokenRemain = _issueWithSingleToken2(_ckToken, address(weth), msg.value, _minCkTokenRec, _midTokens, _weightings, _to, _returnDust);
        // transfer the remaining weth to issuer
        _ckToken.strictInvokeTransfer(
            address(weth),
            msg.sender,
            issueTokenRemain
        );
    }

    /**
     * Issue ckToken with a specified amount of a single asset with specification
     *
     * @param _ckToken              Instance of the CKToken contract
     * @param _issueToken           token used to issue with
     * @param _issueTokenQuantity   amount of issue tokens
     * @param _minCkTokenRec        The minimum amount of CKToken to receive
     * @param _midTokens            The mid tokens in swap route
     * @param _weightings           Eth distribution for each component
     * @param _to                   Address to mint CKToken to
     * @param _returnDust           If to return left components
     */
    function issueWithSingleToken2 (
        ICKToken _ckToken,
        address _issueToken,
        uint256 _issueTokenQuantity,
        uint256 _minCkTokenRec,
        address[] memory _midTokens,
        uint256[] memory _weightings,  // percentage in 18 decimals and order should follow ckComponents get from a ck token
        address _to,
        bool _returnDust
    )   
        external
        nonReentrant
        onlyValidAndInitializedCK(_ckToken) 
    {
        require(_issueTokenQuantity > 0, "Issue token quantity must be > 0");
        // Transfer the specified issue token to ckToken
        transferFrom(
            IERC20(_issueToken),
            msg.sender,
            address(_ckToken),
            _issueTokenQuantity
        );        
        
        uint256 issueTokenRemain = _issueWithSingleToken2(_ckToken, _issueToken, _issueTokenQuantity, _minCkTokenRec, _midTokens, _weightings, _to, _returnDust);
        // transfer the remaining weth to issuer
        _ckToken.strictInvokeTransfer(
            address(_issueToken),
            msg.sender,
            issueTokenRemain
        );
        
    }

    /**
     * Burns a user's CKToken of specified quantity, unwinds external positions, and exchange components
     * to the specified token and return to the specified address. Does not work for debt/negative external positions.
     *
     * @param _ckToken             Instance of the CKToken contract
     * @param _ckTokenQuantity     Quantity of the CKToken to redeem
     * @param _redeemToken         Address of redeem token
     * @param _midTokens           The mid tokens in swap route
     * @param _to                  Address to redeem CKToken to
     * @param _minRedeemTokenToRec Minimum redeem to to receive
     */
    function redeemToSingleToken(
        ICKToken _ckToken,
        uint256 _ckTokenQuantity,
        address _redeemToken,
        address[] memory _midTokens,
        address _to,
        uint256 _minRedeemTokenToRec
    )
        external
        nonReentrant
        onlyValidAndInitializedCK(_ckToken)
    {
        require(_ckTokenQuantity > 0, "Redeem quantity must be > 0");
        _ckToken.burn(msg.sender, _ckTokenQuantity);

        (
            address[] memory components,
            uint256[] memory componentQuantities
        ) = getRequiredComponentIssuanceUnits(_ckToken, _ckTokenQuantity, false);
        uint256 totalRedeemTokenAcquired = 0;
        require(_midTokens.length == components.length, "_midTokens length mismatch");
        for (uint256 i = 0; i < components.length; i++) {
            _executeExternalPositionHooks(_ckToken, _ckTokenQuantity, IERC20(components[i]), false);
            uint256 redeemTokenAcquired = _exchangeDefaultPositionsToRedeemToken(_ckToken, _redeemToken, _midTokens[i], components[i], componentQuantities[i]);
            totalRedeemTokenAcquired = totalRedeemTokenAcquired.add(redeemTokenAcquired);
        }

        require(totalRedeemTokenAcquired >= _minRedeemTokenToRec, "_minRedeemTokenToRec not met");

        _ckToken.strictInvokeTransfer(
            _redeemToken,
            _to,
            totalRedeemTokenAcquired
        );

        emit CKTokenRedeemed(address(_ckToken), msg.sender, _to, _ckTokenQuantity);
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
     * Removes this module from the CKToken, via call by the CKToken. Left with empty logic
     * here because there are no check needed to verify removal.
     */
    function removeModule() external override {}

    /**
     * OWNER ONLY: Set exchange for passed components of the CKToken. Can be called at anytime.
     *
     * @param _components           Array of components
     * @param _exchangeNames        Array of exchange names mapping to correct component
     */
    function setExchanges(
        address[] memory _components,
        string[] memory _exchangeNames
    )
        external
        onlyOwner
    {
        _components.validatePairsWithArray(_exchangeNames);

        for (uint256 i = 0; i < _components.length; i++) {
            require(
                controller.getIntegrationRegistry().isValidIntegration(address(this), _exchangeNames[i]),
                "Unrecognized exchange name"
            );

            exchangeInfo[IERC20(_components[i])] = _exchangeNames[i];
            emit AssetExchangeExecutionParamUpdated(_components[i], _exchangeNames[i]);
        }
    }

    /**
     * OWNER ONLY: Set wrap adapters for passed components of the CKToken. Can be called at anytime.
     *
     * @param _components           Array of components
     * @param _wrapAdapterNames     Array of wrap adapter names mapping to correct component
     * @param _underlyingTokens     Array of underlying tokens mapping to correct component
     */
    function setWrapAdapters(
        address[] memory _components,
        string[] memory _wrapAdapterNames,
        address[] memory _underlyingTokens
    )
    external
    onlyOwner
    {
        _components.validatePairsWithArray(_wrapAdapterNames);
        _components.validatePairsWithArray(_underlyingTokens);

        for (uint256 i = 0; i < _components.length; i++) {
            require(
                controller.getIntegrationRegistry().isValidIntegration(address(this), _wrapAdapterNames[i]),
                "Unrecognized wrap adapter name"
            );

            wrapInfo[IERC20(_components[i])].wrapAdapterName = _wrapAdapterNames[i];
            wrapInfo[IERC20(_components[i])].underlyingToken = _underlyingTokens[i];
            emit AssetWrapExecutionParamUpdated(_components[i], _wrapAdapterNames[i], _underlyingTokens[i]);
        }
    }

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
            require(notionalUnits[i] > 0, "component amount should not be zero");
        }

        return (components, notionalUnits);
    }

    /* ============ Internal Functions ============ */

    /**
     * This is a internal implementation for issue ckToken with a specified amount of a single asset with specification. 
     *
     * @param _ckToken              Instance of the CKToken contract
     * @param _issueToken           token used to issue with
     * @param _issueTokenQuantity   amount of issue tokens
     * @param _minCkTokenRec        The minimum amount of CKToken to receive
     * @param _midTokens            The mid tokens in swap route
     * @param _weightings           Eth distribution for each component
     * @param _to                   Address to mint CKToken to
     * @param _returnDust           If to return left components
     */
    function _issueWithSingleToken2(   
        ICKToken _ckToken,
        address _issueToken,
        uint256 _issueTokenQuantity,
        uint256 _minCkTokenRec,
        address[] memory _midTokens,
        uint256[] memory _weightings,
        address _to,
        bool _returnDust
    ) 
        internal 
        returns(uint256)
    {
        address hookContract = _callPreIssueHooks(_ckToken, _minCkTokenRec, msg.sender, _to);
        address[] memory components = _ckToken.getComponents();
        require(components.length == _weightings.length, "weightings mismatch");
        require(components.length == _midTokens.length, "midTokens mismatch");
        (uint256 maxCkTokenToIssue, uint256 returnedIssueToken) = _issueWithSpec(_ckToken, _issueToken, _issueTokenQuantity, _midTokens, _weightings, _returnDust);
        require(maxCkTokenToIssue >= _minCkTokenRec, "_minCkTokenRec not met");

        _ckToken.mint(_to, maxCkTokenToIssue);

        emit CKTokenIssued(address(_ckToken), msg.sender, _to, hookContract, maxCkTokenToIssue, returnedIssueToken);        
        
        return returnedIssueToken;
    }

    function _issueWithSpec(ICKToken _ckToken, address _issueToken, uint256 _issueTokenQuantity, address[] memory _midTokens, uint256[] memory _weightings, bool _returnDust) 
        internal 
        returns(uint256, uint256)
    {
        uint256 maxCkTokenToIssue = PreciseUnitMath.MAX_UINT_256;
        address[] memory components = _ckToken.getComponents();
        uint256[] memory componentTokenReceiveds = new uint256[](components.length);

        for (uint256 i = 0; i < components.length; i++) {
            uint256 _issueTokenAmountToUse = _issueTokenQuantity.preciseMul(_weightings[i]).sub(1); // avoid underflow
            uint256 componentRealUnitRequired = (_ckToken.getDefaultPositionRealUnit(components[i])).toUint256();
            uint256 componentReceived = _tradeAndWrapComponents(_ckToken, _issueToken, _issueTokenAmountToUse, _midTokens[i] ,components[i]);
            componentTokenReceiveds[i] = componentReceived;
            // guarantee issue ck token amount.
            uint256 maxIssue = componentReceived.preciseDiv(componentRealUnitRequired);
            if (maxIssue <= maxCkTokenToIssue) {
                maxCkTokenToIssue = maxIssue;
            }
        }   

        uint256 issueTokenToReturn = _dustToReturn(_ckToken, _issueToken, _midTokens, componentTokenReceiveds, maxCkTokenToIssue, _returnDust);
 
        return (maxCkTokenToIssue, issueTokenToReturn);
    }

    function _tradeAndWrapComponents(ICKToken _ckToken, address _issueToken, uint256 _issueTokenAmountToUse, address _midToken, address _component) internal returns(uint256) {
        uint256 componentTokenReceived;
        if (_issueToken == _component) {
            componentTokenReceived = _issueTokenAmountToUse;     
        } else if (wrapInfo[IERC20(_component)].underlyingToken == address(0)) {
            // For underlying tokens, exchange directly
            (, componentTokenReceived) = _trade(_ckToken, _issueToken, _midToken, _component, _issueTokenAmountToUse, true);
        } else {
            // For wrapped tokens, exchange to underlying tokens first and then wrap it
            WrapExecutionParams memory wrapExecutionParams = wrapInfo[IERC20(_component)];
            IWrapAdapter wrapAdapter = IWrapAdapter(getAndValidateAdapter(wrapExecutionParams.wrapAdapterName));
            uint256 underlyingReceived = 0;
            if (wrapExecutionParams.underlyingToken == wrapAdapter.ETH_TOKEN_ADDRESS()) {
                if (_issueToken != address(weth)) {
                    (, underlyingReceived) = _trade(_ckToken, _issueToken, _midToken, address(weth), _issueTokenAmountToUse, true);
                } else {
                    underlyingReceived = _issueTokenAmountToUse;
                }
                componentTokenReceived = _wrap(_ckToken, wrapExecutionParams.underlyingToken, _component, underlyingReceived, wrapExecutionParams.wrapAdapterName, true);
            } else {
                (, underlyingReceived) = _trade(_ckToken, _issueToken, _midToken, wrapExecutionParams.underlyingToken , _issueTokenAmountToUse, true);
                componentTokenReceived = _wrap(_ckToken, wrapExecutionParams.underlyingToken, _component, underlyingReceived, wrapExecutionParams.wrapAdapterName, false);
            }
        }

        return componentTokenReceived;
    }
    
    /**
     * Swap remaining component back to issue token.
     */
    function _dustToReturn(ICKToken _ckToken, address _issueToken, address[] memory _midTokens, uint256[] memory componentTokenReceiveds, uint256 maxCkTokenToIssue, bool _returnDust) internal returns(uint256) {
        if (!_returnDust) {
            return 0;
        }
        uint256 issueTokenToReturn = 0;
        address[] memory components = _ckToken.getComponents();

        for(uint256 i = 0; i < components.length; i++) {
            uint256 requiredComponentUnit = ((_ckToken.getDefaultPositionRealUnit(components[i])).toUint256()).preciseMul(maxCkTokenToIssue);
            uint256 toReturn = componentTokenReceiveds[i].sub(requiredComponentUnit);
            uint256 diffPercentage = toReturn.preciseDiv(requiredComponentUnit); // percentage in 18 decimals
            if (diffPercentage > (PreciseUnitMath.preciseUnit().div(10000))) { // 0.01%
                issueTokenToReturn = issueTokenToReturn.add(_exchangeDefaultPositionsToRedeemToken(_ckToken, _issueToken, _midTokens[i], components[i], toReturn));
            }
        }     

        return issueTokenToReturn;
    }    

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

    function _exchangeDefaultPositionsToRedeemToken(ICKToken _ckToken, address _redeemToken, address _midToken, address _component, uint256 _componentQuantity) internal returns(uint256) {
        uint256 redeemTokenAcquired;
        if (_redeemToken == _component) {
            // continue if redeem token is component token
            redeemTokenAcquired = _componentQuantity;
        } else if (wrapInfo[IERC20(_component)].underlyingToken == address(0)) {
            // For underlying tokens, exchange directly
            
            (, redeemTokenAcquired) = _trade(_ckToken, _component, _midToken, _redeemToken, _componentQuantity, true);
        } else {
            // For wrapped tokens, unwrap it and exchange underlying tokens to redeem tokens
            WrapExecutionParams memory wrapExecutionParams = wrapInfo[IERC20(_component)];
            IWrapAdapter wrapAdapter = IWrapAdapter(getAndValidateAdapter(wrapExecutionParams.wrapAdapterName));

            (uint256 underlyingReceived, uint256 unwrappedAmount) = 
            _unwrap(_ckToken, wrapExecutionParams.underlyingToken, _component, _componentQuantity, wrapExecutionParams.wrapAdapterName, wrapExecutionParams.underlyingToken == wrapAdapter.ETH_TOKEN_ADDRESS());

            if (wrapExecutionParams.underlyingToken == wrapAdapter.ETH_TOKEN_ADDRESS()) {
                (, redeemTokenAcquired) = _trade(_ckToken, address(weth), _midToken, _redeemToken, underlyingReceived, true);                
            } else {
                (, redeemTokenAcquired) = _trade(_ckToken, wrapExecutionParams.underlyingToken, _midToken, _redeemToken, underlyingReceived, true);                
            }    
        }
        return redeemTokenAcquired;
    }

    /**
     * Take snapshot of CKToken's balance of underlying and wrapped tokens.
     */
    function _snapshotTargetTokenBalance(
        ICKToken _ckToken,
        address _targetToken
    ) internal view returns(uint256) {
        uint256 targetTokenBalance = IERC20(_targetToken).balanceOf(address(_ckToken));
        return (targetTokenBalance);
    }

    /**
     * Validate post trade data.
     *
     * @param _tradeInfo                Struct containing trade information used in internal functions
     */
    function _validatePostTrade(TradeInfo memory _tradeInfo) internal view returns (uint256) {
        uint256 exchangedQuantity = IERC20(_tradeInfo.receiveToken)
        .balanceOf(address(_tradeInfo.ckToken))
        .sub(_tradeInfo.preTradeReceiveTokenBalance);

        require(
            exchangedQuantity >= _tradeInfo.totalReceiveQuantity, "Slippage too big"
        );
        return exchangedQuantity;
    }

    /**
     * Validate pre trade data. Check exchange is valid, token quantity is valid.
     *
     * @param _tradeInfo            Struct containing trade information used in internal functions
     */
    function _validatePreTradeData(TradeInfo memory _tradeInfo) internal view {
        require(_tradeInfo.totalSendQuantity > 0, "Token to sell must be nonzero");
        uint256 sendTokenBalance = IERC20(_tradeInfo.sendToken).balanceOf(address(_tradeInfo.ckToken));
        require(
            sendTokenBalance >= _tradeInfo.totalSendQuantity,
            "total send quantity cant be greater than existing"
        );
    }

    /**
     * Create and return TradeInfo struct
     *
     * @param _ckToken              Instance of the CKToken to trade
     * @param _exchangeAdapter      The exchange adapter in the integrations registry
     * @param _sendToken            Address of the token to be sent to the exchange
     * @param _midToken             Address of the token in route
     * @param _receiveToken         Address of the token that will be received from the exchange
     * @param _exactQuantity        Exact token quantity during trade
     * @param _isSendTokenFixed     Indicate if the send token is fixed
     *
     * return TradeInfo             Struct containing data for trade
     */
    function _createTradeInfo(
        ICKToken _ckToken,
        IExchangeAdapter _exchangeAdapter,
        address _sendToken,
        address _midToken,
        address _receiveToken,
        uint256 _exactQuantity,
        bool _isSendTokenFixed
    )
        internal
        view
        returns (TradeInfo memory)
    {
        console.log("=================");
        uint256 thresholdAmount;
        address[] memory path;
        if (_midToken == address(0) || _midToken == _sendToken || _midToken == _receiveToken) {
            path = new address[](2);
            path[0] = _sendToken;
            path[1] = _receiveToken;
            console.log(path[0]);
            console.log(path[1]);            
        } else {
            path = new address[](3);
            path[0] = _sendToken;
            path[1] = _midToken;
            path[2] = _receiveToken;
            console.log(path[0]);
            console.log(path[1]);
            console.log(path[2]);
        }


        TradeInfo memory tradeInfo;
        tradeInfo.ckToken = _ckToken;
        tradeInfo.exchangeAdapter = _exchangeAdapter;
        tradeInfo.sendToken = _sendToken;
        tradeInfo.receiveToken = _receiveToken;
        tradeInfo.totalSendQuantity =  _exactQuantity;
        tradeInfo.totalReceiveQuantity = 0;
        tradeInfo.preTradeSendTokenBalance = _snapshotTargetTokenBalance(_ckToken, _sendToken);
        tradeInfo.preTradeReceiveTokenBalance = _snapshotTargetTokenBalance(_ckToken, _receiveToken);
        tradeInfo.data = _isSendTokenFixed ? _exchangeAdapter.generateDataParam(path, true) : _exchangeAdapter.generateDataParam(path, false);
        return tradeInfo;
    }

    /**
     * Invoke approve for send token, get method data and invoke trade in the context of the CKToken.
     *
     * @param _ckToken              Instance of the CKToken to trade
     * @param _exchangeAdapter      Exchange adapter in the integrations registry
     * @param _sendToken            Address of the token to be sent to the exchange
     * @param _receiveToken         Address of the token that will be received from the exchange
     * @param _sendQuantity         Units of token in CKToken sent to the exchange
     * @param _receiveQuantity      Units of token in CKToken received from the exchange
     * @param _data                 Arbitrary bytes to be used to construct trade call data
     */
    function _executeTrade(
        ICKToken _ckToken,
        IExchangeAdapter _exchangeAdapter,
        address _sendToken,
        address _receiveToken,
        uint256 _sendQuantity,
        uint256 _receiveQuantity,
        bytes memory _data
    )
        internal
    {
        // Get spender address from exchange adapter and invoke approve for exact amount on CKToken
        _ckToken.invokeApprove(
            _sendToken,
            _exchangeAdapter.getSpender(),
            _sendQuantity
        );

        (
            address targetExchange,
            uint256 callValue,
            bytes memory methodData
        ) = _exchangeAdapter.getTradeCalldata(
            _sendToken,
            _receiveToken,
            address(_ckToken),
            _sendQuantity,
            _receiveQuantity,
            _data
        );

        _ckToken.invoke(targetExchange, callValue, methodData);
    }

    /**
     * Executes a trade on a supported DEX.
     *
     * @param _ckToken              Instance of the CKToken to trade
     * @param _sendToken            Address of the token to be sent to the exchange
     * @param _midToken             _midToken
     * @param _receiveToken         Address of the token that will be received from the exchange     
     * @param _exactQuantity        Exact Quantity of token in CKToken to be sent or received from the exchange
     * @param _isSendTokenFixed     Indicate if the send token is fixed
     */
    function _trade(
        ICKToken _ckToken,
        address _sendToken,
        address _midToken,
        address _receiveToken,
        uint256 _exactQuantity,
        bool _isSendTokenFixed
    )
        internal
        returns (uint256, uint256)
    {
        if (address(_sendToken) == address(_receiveToken)) {
            return (_exactQuantity, _exactQuantity);
        }
        TradeInfo memory tradeInfo = _createTradeInfo(
            _ckToken,
            IExchangeAdapter(getAndValidateAdapter(exchangeInfo[IERC20(_receiveToken)])),
            _sendToken,
            _midToken,
            _receiveToken,
            _exactQuantity,
            _isSendTokenFixed
        );
        _validatePreTradeData(tradeInfo);
        _executeTrade(tradeInfo.ckToken, tradeInfo.exchangeAdapter, tradeInfo.sendToken, tradeInfo.receiveToken, tradeInfo.totalSendQuantity, tradeInfo.totalReceiveQuantity, tradeInfo.data);
        _validatePostTrade(tradeInfo);
        uint256 totalSendQuantity = tradeInfo.preTradeSendTokenBalance.sub(_snapshotTargetTokenBalance(_ckToken, _sendToken));
        uint256 totalReceiveQuantity = _snapshotTargetTokenBalance(_ckToken, _receiveToken).sub(tradeInfo.preTradeReceiveTokenBalance);
        emit ComponentExchanged(
            _ckToken,
            _sendToken,
            _receiveToken,
            tradeInfo.exchangeAdapter,
            totalSendQuantity,
            totalReceiveQuantity
        );
        return (totalSendQuantity, totalReceiveQuantity);
    }

    /**
     * Instructs the CKToken to wrap an underlying asset into a wrappedToken via a specified adapter.
     *
     * @param _ckToken              Instance of the CKToken
     * @param _underlyingToken      Address of the component to be wrapped
     * @param _wrappedToken         Address of the desired wrapped token
     * @param _underlyingQuantity   Quantity of underlying tokens to wrap
     * @param _integrationName      Name of wrap module integration (mapping on integration registry)
     */
    function _wrap(
        ICKToken _ckToken,
        address _underlyingToken,
        address _wrappedToken,
        uint256 _underlyingQuantity,
        string memory _integrationName,
        bool _usesEther
    )
        internal
        returns (uint256)
    {
        (
        uint256 notionalUnderlyingWrapped,
        uint256 notionalWrapped
        ) = _validateAndWrap(
            _integrationName,
            _ckToken,
            _underlyingToken,
            _wrappedToken,
            _underlyingQuantity,
            _usesEther // does not use Ether
        );

        emit ComponentWrapped(
            _ckToken,
            _underlyingToken,
            _wrappedToken,
            notionalUnderlyingWrapped,
            notionalWrapped,
            _integrationName
        );
        return notionalWrapped;
    }

    /**
     * MANAGER-ONLY: Instructs the CKToken to unwrap a wrapped asset into its underlying via a specified adapter.
     *
     * @param _ckToken              Instance of the CKToken
     * @param _underlyingToken      Address of the underlying asset
     * @param _wrappedToken         Address of the component to be unwrapped
     * @param _wrappedQuantity      Quantity of wrapped tokens in Position units
     * @param _integrationName      ID of wrap module integration (mapping on integration registry)
     */
    function _unwrap(
        ICKToken _ckToken,
        address _underlyingToken,
        address _wrappedToken,
        uint256 _wrappedQuantity,
        string memory _integrationName,
        bool _usesEther
    )
        internal returns (uint256, uint256)
    {
        (
        uint256 notionalUnderlyingUnwrapped,
        uint256 notionalUnwrapped
        ) = _validateAndUnwrap(
            _integrationName,
            _ckToken,
            _underlyingToken,
            _wrappedToken,
            _wrappedQuantity,
            _usesEther // uses Ether
        );

        emit ComponentUnwrapped(
            _ckToken,
            _underlyingToken,
            _wrappedToken,
            notionalUnderlyingUnwrapped,
            notionalUnwrapped,
            _integrationName
        );

        return (notionalUnderlyingUnwrapped, notionalUnwrapped);
    }

    /**
     * The WrapModule approves the underlying to the 3rd party
     * integration contract, then invokes the CKToken to call wrap by passing its calldata along. When raw ETH
     * is being used (_usesEther = true) WETH position must first be unwrapped and underlyingAddress sent to
     * adapter must be external protocol's ETH representative address.
     *
     * Returns notional amount of underlying tokens and wrapped tokens that were wrapped.
     */
    function _validateAndWrap(
        string memory _integrationName,
        ICKToken _ckToken,
        address _underlyingToken,
        address _wrappedToken,
        uint256 _underlyingQuantity,
        bool _usesEther
    )
        internal
        returns (uint256, uint256)
    {
        uint256 preActionUnderlyingNotional;
        // Snapshot pre wrap balances
        uint256 preActionWrapNotional = _snapshotTargetTokenBalance(_ckToken, _wrappedToken);

        IWrapAdapter wrapAdapter = IWrapAdapter(getAndValidateAdapter(_integrationName));

        address snapshotToken = _usesEther ? address(weth) : _underlyingToken;
        _validateInputs(_ckToken, snapshotToken, _underlyingQuantity);
        preActionUnderlyingNotional = _snapshotTargetTokenBalance(_ckToken, snapshotToken);

        // Execute any pre-wrap actions depending on if using raw ETH or not
        if (_usesEther) {
            _ckToken.invokeUnwrapWETH(address(weth), _underlyingQuantity);
        } else {
            address spender = wrapAdapter.getWrapSpenderAddress(_underlyingToken, _wrappedToken);
            _ckToken.invokeApprove(_underlyingToken, spender, _underlyingQuantity.add(1));
        }

        // Get function call data and invoke on CKToken
        _createWrapDataAndInvoke(
            _ckToken,
            wrapAdapter,
            _usesEther ? wrapAdapter.ETH_TOKEN_ADDRESS() : _underlyingToken,
            _wrappedToken,
            _underlyingQuantity
        );

        // Snapshot post wrap balances
        uint256 postActionUnderlyingNotional = _snapshotTargetTokenBalance(_ckToken, snapshotToken);
        uint256 postActionWrapNotional = _snapshotTargetTokenBalance(_ckToken, _wrappedToken);
        return (
            preActionUnderlyingNotional.sub(postActionUnderlyingNotional),
            postActionWrapNotional.sub(preActionWrapNotional)
        );
    }

    /**
     * The WrapModule calculates the total notional wrap token to unwrap, then invokes the CKToken to call
     * unwrap by passing its calldata along. When raw ETH is being used (_usesEther = true) underlyingAddress
     * sent to adapter must be set to external protocol's ETH representative address and ETH returned from
     * external protocol is wrapped.
     *
     * Returns notional amount of underlying tokens and wrapped tokens unwrapped.
     */
    function _validateAndUnwrap(
        string memory _integrationName,
        ICKToken _ckToken,
        address _underlyingToken,
        address _wrappedToken,
        uint256 _wrappedTokenQuantity,
        bool _usesEther
    )
        internal
        returns (uint256, uint256)
    {
        _validateInputs(_ckToken, _wrappedToken, _wrappedTokenQuantity);

        // Snapshot pre wrap balance
        address snapshotToken = _usesEther ? address(weth) : _underlyingToken;
        uint256 preActionUnderlyingNotional = _snapshotTargetTokenBalance(_ckToken, snapshotToken);
        uint256 preActionWrapNotional = _snapshotTargetTokenBalance(_ckToken, _wrappedToken);

        IWrapAdapter wrapAdapter = IWrapAdapter(getAndValidateAdapter(_integrationName));
        address unWrapSpender = wrapAdapter.getUnwrapSpenderAddress(_underlyingToken, _wrappedToken);
        _ckToken.invokeApprove(_wrappedToken, unWrapSpender, _wrappedTokenQuantity);
        
        // Get function call data and invoke on CKToken
        _createUnwrapDataAndInvoke(
            _ckToken,
            wrapAdapter,
            _usesEther ? wrapAdapter.ETH_TOKEN_ADDRESS() : _underlyingToken,
            _wrappedToken,
            _wrappedTokenQuantity
        );

        // immediately wrap to WTH after getting back ETH
        if (_usesEther) {
            _ckToken.invokeWrapWETH(address(weth), address(_ckToken).balance);
        }
        
        // Snapshot post wrap balances
        uint256 postActionUnderlyingNotional = _snapshotTargetTokenBalance(_ckToken, snapshotToken);
        uint256 postActionWrapNotional = _snapshotTargetTokenBalance(_ckToken, _wrappedToken);
        return (
            postActionUnderlyingNotional.sub(preActionUnderlyingNotional),
            preActionWrapNotional.sub(postActionWrapNotional)
        );
    }

    /**
     * Validates the wrap operation is valid. In particular, the following checks are made:
     * - The position is Default
     * - The position has sufficient units given the transact quantity
     * - The transact quantity > 0
     *
     * It is expected that the adapter will check if wrappedToken/underlyingToken are a valid pair for the given
     * integration.
     */
    function _validateInputs(
        ICKToken _ckToken,
        address _component,
        uint256 _quantity
    )
        internal
        view
    {
        require(_quantity > 0, "component quantity must be > 0");
        require(_snapshotTargetTokenBalance(_ckToken, _component) >= _quantity, "quantity cant be greater than existing");
    }

    /**
     * Create the calldata for wrap and then invoke the call on the CKToken.
     */
    function _createWrapDataAndInvoke(
        ICKToken _ckToken,
        IWrapAdapter _wrapAdapter,
        address _underlyingToken,
        address _wrappedToken,
        uint256 _notionalUnderlying
    ) internal {
        (
            address callTarget,
            uint256 callValue,
            bytes memory callByteData
        ) = _wrapAdapter.getWrapCallData(
            _underlyingToken,
            _wrappedToken,
            _notionalUnderlying
        );

        _ckToken.invoke(callTarget, callValue, callByteData);
    }

    /**
     * Create the calldata for unwrap and then invoke the call on the CKToken.
     */
    function _createUnwrapDataAndInvoke(
        ICKToken _ckToken,
        IWrapAdapter _wrapAdapter,
        address _underlyingToken,
        address _wrappedToken,
        uint256 _notionalUnderlying
    ) internal {
        (
            address callTarget,
            uint256 callValue,
            bytes memory callByteData
        ) = _wrapAdapter.getUnwrapCallData(
            _underlyingToken,
            _wrappedToken,
            _notionalUnderlying
        );

        _ckToken.invoke(callTarget, callValue, callByteData);
    }
}
