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

import { IController } from "../../interfaces/IController.sol";
import { IIntegrationRegistry } from "../../interfaces/IIntegrationRegistry.sol";
import { Invoke } from "../lib/Invoke.sol";
import { ICKToken } from "../../interfaces/ICKToken.sol";
import { IWETH } from "../../interfaces/external/IWETH.sol";
import { IWrapAdapter } from "../../interfaces/IWrapAdapter.sol";
import { ModuleBase } from "../lib/ModuleBase.sol";
import { Position } from "../lib/Position.sol";
import { PreciseUnitMath } from "../../lib/PreciseUnitMath.sol";

/**
 * @title WrapModule
 * @author Cook Finance
 *
 * Module that enables the wrapping of ERC20 and Ether positions via third party protocols. The WrapModule
 * works in conjunction with WrapAdapters, in which the wrapAdapterID / integrationNames are stored on the
 * integration registry.
 *
 * Some examples of wrap actions include wrapping, DAI to cDAI (Compound) or Dai to aDai (AAVE).
 */
contract WrapModule is ModuleBase, ReentrancyGuard {
    using SafeCast for int256;
    using PreciseUnitMath for uint256;
    using Position for uint256;
    using SafeMath for uint256;

    using Invoke for ICKToken;
    using Position for ICKToken.Position;
    using Position for ICKToken;

    /* ============ Events ============ */

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

    // Wrapped ETH address
    IWETH public weth;

    /* ============ Constructor ============ */

    /**
     * @param _controller               Address of controller contract
     * @param _weth                     Address of wrapped eth
     */
    constructor(IController _controller, IWETH _weth) public ModuleBase(_controller) {
        weth = _weth;
    }

    /* ============ External Functions ============ */
    
    /**
     * MANAGER-ONLY: Instructs the CKToken to wrap an underlying asset into a wrappedToken via a specified adapter.
     *
     * @param _ckToken             Instance of the CKToken
     * @param _underlyingToken      Address of the component to be wrapped
     * @param _wrappedToken         Address of the desired wrapped token
     * @param _underlyingUnits      Quantity of underlying units in Position units
     * @param _integrationName      Name of wrap module integration (mapping on integration registry)
     */
    function wrap(
        ICKToken _ckToken,
        address _underlyingToken,
        address _wrappedToken,
        uint256 _underlyingUnits,
        string calldata _integrationName
    ) 
        external
        nonReentrant
        onlyManagerAndValidCK(_ckToken)
    {
        (
            uint256 notionalUnderlyingWrapped,
            uint256 notionalWrapped
        ) = _validateWrapAndUpdate(
            _integrationName,
            _ckToken,
            _underlyingToken,
            _wrappedToken,
            _underlyingUnits,
            false // does not use Ether
        );

        emit ComponentWrapped(
            _ckToken,
            _underlyingToken,
            _wrappedToken,
            notionalUnderlyingWrapped,
            notionalWrapped,
            _integrationName
        );
    }

    /**
     * MANAGER-ONLY: Instructs the CKToken to wrap Ether into a wrappedToken via a specified adapter. Since CKTokens
     * only hold WETH, in order to support protocols that collateralize with Ether the CKToken's WETH must be unwrapped
     * first before sending to the external protocol.
     *
     * @param _ckToken             Instance of the CKToken
     * @param _wrappedToken         Address of the desired wrapped token
     * @param _underlyingUnits      Quantity of underlying units in Position units
     * @param _integrationName      Name of wrap module integration (mapping on integration registry)
     */
    function wrapWithEther(
        ICKToken _ckToken,
        address _wrappedToken,
        uint256 _underlyingUnits,
        string calldata _integrationName
    ) 
        external
        nonReentrant
        onlyManagerAndValidCK(_ckToken)
    {
        (
            uint256 notionalUnderlyingWrapped,
            uint256 notionalWrapped
        ) = _validateWrapAndUpdate(
            _integrationName,
            _ckToken,
            address(weth),
            _wrappedToken,
            _underlyingUnits,
            true // uses Ether
        );

        emit ComponentWrapped(
            _ckToken,
            address(weth),
            _wrappedToken,
            notionalUnderlyingWrapped,
            notionalWrapped,
            _integrationName
        );
    }

    /**
     * MANAGER-ONLY: Instructs the CKToken to unwrap a wrapped asset into its underlying via a specified adapter.
     *
     * @param _ckToken             Instance of the CKToken
     * @param _underlyingToken      Address of the underlying asset
     * @param _wrappedToken         Address of the component to be unwrapped
     * @param _wrappedUnits         Quantity of wrapped tokens in Position units
     * @param _integrationName      ID of wrap module integration (mapping on integration registry)
     */
    function unwrap(
        ICKToken _ckToken,
        address _underlyingToken,
        address _wrappedToken,
        uint256 _wrappedUnits,
        string calldata _integrationName
    )
        external
        nonReentrant
        onlyManagerAndValidCK(_ckToken)
    {
        (
            uint256 notionalUnderlyingUnwrapped,
            uint256 notionalUnwrapped
        ) = _validateUnwrapAndUpdate(
            _integrationName,
            _ckToken,
            _underlyingToken,
            _wrappedToken,
            _wrappedUnits,
            false // uses Ether
        );

        emit ComponentUnwrapped(
            _ckToken,
            _underlyingToken,
            _wrappedToken,
            notionalUnderlyingUnwrapped,
            notionalUnwrapped,
            _integrationName
        );
    }

    /**
     * MANAGER-ONLY: Instructs the CKToken to unwrap a wrapped asset collateralized by Ether into Wrapped Ether. Since
     * external protocol will send back Ether that Ether must be Wrapped into WETH in order to be accounted for by CKToken.
     *
     * @param _ckToken                 Instance of the CKToken
     * @param _wrappedToken             Address of the component to be unwrapped
     * @param _wrappedUnits             Quantity of wrapped tokens in Position units
     * @param _integrationName          ID of wrap module integration (mapping on integration registry)
     */
    function unwrapWithEther(
        ICKToken _ckToken,
        address _wrappedToken,
        uint256 _wrappedUnits,
        string calldata _integrationName
    )
        external
        nonReentrant
        onlyManagerAndValidCK(_ckToken)
    {
        (
            uint256 notionalUnderlyingUnwrapped,
            uint256 notionalUnwrapped
        ) = _validateUnwrapAndUpdate(
            _integrationName,
            _ckToken,
            address(weth),
            _wrappedToken,
            _wrappedUnits,
            true // uses Ether
        );

        emit ComponentUnwrapped(
            _ckToken,
            address(weth),
            _wrappedToken,
            notionalUnderlyingUnwrapped,
            notionalUnwrapped,
            _integrationName
        );
    }

    /**
     * Initializes this module to the CKToken. Only callable by the CKToken's manager.
     *
     * @param _ckToken             Instance of the CKToken to issue
     */
    function initialize(ICKToken _ckToken) external onlyCKManager(_ckToken, msg.sender) {
        require(controller.isCK(address(_ckToken)), "Must be controller-enabled CKToken");
        require(isCKPendingInitialization(_ckToken), "Must be pending initialization");
        _ckToken.initializeModule();
    }

    /**
     * Removes this module from the CKToken, via call by the CKToken.
     */
    function removeModule() external override {}


    /* ============ Internal Functions ============ */

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
        address _transactPosition,
        uint256 _transactPositionUnits
    ) 
        internal
        view
    {
        require(_transactPositionUnits > 0, "Target position units must be > 0");
        require(_ckToken.hasDefaultPosition(_transactPosition), "Target default position must be component");
        require(
            _ckToken.hasSufficientDefaultUnits(_transactPosition, _transactPositionUnits),
            "Unit cant be greater than existing"
        );
    }

    /**
     * The WrapModule calculates the total notional underlying to wrap, approves the underlying to the 3rd party 
     * integration contract, then invokes the CKToken to call wrap by passing its calldata along. When raw ETH
     * is being used (_usesEther = true) WETH position must first be unwrapped and underlyingAddress sent to 
     * adapter must be external protocol's ETH representative address.
     *
     * Returns notional amount of underlying tokens and wrapped tokens that were wrapped.
     */
    function _validateWrapAndUpdate(
        string calldata _integrationName,
        ICKToken _ckToken,
        address _underlyingToken,
        address _wrappedToken,
        uint256 _underlyingUnits,
        bool _usesEther
    ) 
        internal
        returns (uint256, uint256)
    {
        _validateInputs(_ckToken, _underlyingToken, _underlyingUnits);

        // Snapshot pre wrap balances
        (
            uint256 preActionUnderlyingNotional,
            uint256 preActionWrapNotional
        ) = _snapshotTargetAssetsBalance(_ckToken, _underlyingToken, _wrappedToken);

        uint256 notionalUnderlying = _ckToken.totalSupply().getDefaultTotalNotional(_underlyingUnits);
        IWrapAdapter wrapAdapter = IWrapAdapter(getAndValidateAdapter(_integrationName));

        // Execute any pre-wrap actions depending on if using raw ETH or not
        if (_usesEther) {
            _ckToken.invokeUnwrapWETH(address(weth), notionalUnderlying);
        } else {
            address spender = wrapAdapter.getSpenderAddress(_underlyingToken, _wrappedToken);

            _ckToken.invokeApprove(_underlyingToken, spender, notionalUnderlying);
        }

        // Get function call data and invoke on CKToken
        _createWrapDataAndInvoke(
            _ckToken,
            wrapAdapter,
            _usesEther ? wrapAdapter.ETH_TOKEN_ADDRESS() : _underlyingToken,
            _wrappedToken,
            notionalUnderlying
        );

        // Snapshot post wrap balances
        (
            uint256 postActionUnderlyingNotional,
            uint256 postActionWrapNotional
        ) = _snapshotTargetAssetsBalance(_ckToken, _underlyingToken, _wrappedToken);

        _updatePosition(_ckToken, _underlyingToken, preActionUnderlyingNotional, postActionUnderlyingNotional);
        _updatePosition(_ckToken, _wrappedToken, preActionWrapNotional, postActionWrapNotional);

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
    function _validateUnwrapAndUpdate(
        string calldata _integrationName,
        ICKToken _ckToken,
        address _underlyingToken,
        address _wrappedToken,
        uint256 _wrappedTokenUnits,
        bool _usesEther
    )
        internal
        returns (uint256, uint256)
    {
        _validateInputs(_ckToken, _wrappedToken, _wrappedTokenUnits);

        (
            uint256 preActionUnderlyingNotional,
            uint256 preActionWrapNotional
        ) = _snapshotTargetAssetsBalance(_ckToken, _underlyingToken, _wrappedToken);

        uint256 notionalWrappedToken = _ckToken.totalSupply().getDefaultTotalNotional(_wrappedTokenUnits);
        IWrapAdapter wrapAdapter = IWrapAdapter(getAndValidateAdapter(_integrationName));

        // Get function call data and invoke on CKToken
        _createUnwrapDataAndInvoke(
            _ckToken,
            wrapAdapter,
            _usesEther ? wrapAdapter.ETH_TOKEN_ADDRESS() : _underlyingToken,
            _wrappedToken,
            notionalWrappedToken
        );

        if (_usesEther) {
            _ckToken.invokeWrapWETH(address(weth), address(_ckToken).balance);
        }

        (
            uint256 postActionUnderlyingNotional,
            uint256 postActionWrapNotional
        ) = _snapshotTargetAssetsBalance(_ckToken, _underlyingToken, _wrappedToken);

        _updatePosition(_ckToken, _underlyingToken, preActionUnderlyingNotional, postActionUnderlyingNotional);
        _updatePosition(_ckToken, _wrappedToken, preActionWrapNotional, postActionWrapNotional);

        return (
            postActionUnderlyingNotional.sub(preActionUnderlyingNotional),
            preActionWrapNotional.sub(postActionWrapNotional)
        );
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

    /**
     * After a wrap/unwrap operation, check the underlying and wrap token quantities and recalculate
     * the units ((total tokens - airdrop)/ total supply). Then update the position on the CKToken.
     */
    function _updatePosition(
        ICKToken _ckToken,
        address _token,
        uint256 _preActionTokenBalance,
        uint256 _postActionTokenBalance
    ) internal {
        uint256 newUnit = _ckToken.totalSupply().calculateDefaultEditPositionUnit(
            _preActionTokenBalance,
            _postActionTokenBalance,
            _ckToken.getDefaultPositionRealUnit(_token).toUint256()
        );

        _ckToken.editDefaultPosition(_token, newUnit);
    }

    /**
     * Take snapshot of CKToken's balance of underlying and wrapped tokens.
     */
    function _snapshotTargetAssetsBalance(
        ICKToken _ckToken,
        address _underlyingToken,
        address _wrappedToken
    ) internal view returns(uint256, uint256) {
        uint256 underlyingTokenBalance = IERC20(_underlyingToken).balanceOf(address(_ckToken));
        uint256 wrapTokenBalance = IERC20(_wrappedToken).balanceOf(address(_ckToken));

        return (
            underlyingTokenBalance,
            wrapTokenBalance            
        );
    }
}