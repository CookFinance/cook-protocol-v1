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

import { ICErc20 } from "../../../interfaces/external/ICErc20.sol";
import { ISafeBox } from "../../../interfaces/external/ISafeBox.sol";
import { ISafeBoxETH } from "../../../interfaces/external/ISafeBoxETH.sol";
import { Compound } from "../lib/Compound.sol";
import { PreciseUnitMath } from "../../../lib/PreciseUnitMath.sol";

/**
 * @title AlphaHomoraV2WrapAdapter
 * @author Cook Finance, Ember Fund
 *
 * Wrap adapter for AlphaHomoraV2WrapAdapter that returns data for wraps/unwraps of tokens
 */
contract AlphaHomoraV2WrapAdapter {
    using Compound for ICErc20;
    using PreciseUnitMath for uint256;

    /* ============ Constants ============ */

    address public constant ETH_TOKEN_ADDRESS = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;
    address public immutable WETH;

    /* ============ Constructor ============ */

    constructor(address _weth) public {
        WETH = _weth;
    }

    /* ============ Modifiers ============ */

    /**
     * Throws if the underlying/wrapped token pair is not valid
     */
    modifier onlyValidTokenPair(address _underlyingToken, address _wrappedToken) {
        require(validTokenPair(_underlyingToken, _wrappedToken), "Must be a valid token pair");
        _;
    }

    /* ============ External Getter Functions ============ */

    /**
     * Generates the calldata to wrap an underlying asset into a wrappedToken.
     *
     * @param _underlyingToken      Address of the component to be wrapped
     * @param _wrappedToken         Address of the desired wrapped token
     * @param _underlyingUnits      Total quantity of underlying units to wrap
     *
     * @return address              Target contract address
     * @return uint256              Total quantity of underlying units (if underlying is ETH)
     * @return bytes                Wrap calldata
     */
    function getWrapCallData(
        address _underlyingToken,
        address _wrappedToken,
        uint256 _underlyingUnits
    )
        external
        view
         onlyValidTokenPair(_underlyingToken, _wrappedToken)
        returns (address, uint256, bytes memory)
    {
        uint256 value;
        bytes memory callData;
        if (_underlyingToken == ETH_TOKEN_ADDRESS) {
            value = _underlyingUnits;
            callData = abi.encodeWithSignature("deposit()");
        } else {
            value = 0;
            callData = abi.encodeWithSignature("deposit(uint256)", _underlyingUnits);
        }

        return (_wrappedToken, value, callData);
    }

    /**
     * Generates the calldata to unwrap a wrapped asset into its underlying.
     *
     * @param _underlyingToken      Address of the underlying asset
     * @param _wrappedToken         Address of the component to be unwrapped
     * @param _wrappedTokenUnits    Total quantity of wrapped token units to unwrap
     *
     * @return address              Target contract address
     * @return uint256              Total quantity of wrapped token units to unwrap. This will always be 0 for unwrapping
     * @return bytes                Unwrap calldata
     */
    function getUnwrapCallData(
        address _underlyingToken,
        address _wrappedToken,
        uint256 _wrappedTokenUnits
    )
        external
        view
         onlyValidTokenPair(_underlyingToken, _wrappedToken)
        returns (address, uint256, bytes memory)
    {
        bytes memory callData = abi.encodeWithSignature("withdraw(uint256)", _wrappedTokenUnits);
        return (_wrappedToken, 0, callData);
    }

    /**
     * Get total quantity of underlying token to get the specific amount of the wrapped token.
     *
     * @param _underlyingToken      Address of the component to be wrapped
     * @param _wrappedToken         Address of the desired wrapped token
     * @param _wrappedTokenAmount   Amount of wrapped token to get
     *
     * @return uint256              Total quantity of underlying units to deposit
     */
    function getDepositUnderlyingTokenAmount(
        address _underlyingToken,
        address _wrappedToken,
        uint256 _wrappedTokenAmount
    )
        external
        view
        onlyValidTokenPair(_underlyingToken, _wrappedToken)
        returns (uint256)
    {
        ICErc20 cToken = ICErc20(ISafeBox(_wrappedToken).cToken());
        return _wrappedTokenAmount.preciseMul(cToken.exchangeRateStored());
    }

    /**
     * Get total quantity of underlying token to be returned when withdraw the wrapped token.
     *
     * @param _underlyingToken      Address of the component to be returned
     * @param _wrappedToken         Address of the desired wrapped token
     * @param _wrappedTokenAmount   Amount of wrapped token to withdraw
     *
     * @return uint256              Total quantity of underlying units to be returned
     */
    function getWithdrawUnderlyingTokenAmount(
        address _underlyingToken,
        address _wrappedToken,
        uint256 _wrappedTokenAmount
    )
        external
        view
        onlyValidTokenPair(_underlyingToken, _wrappedToken)
        returns (uint256)
    {
        ICErc20 cToken = ICErc20(ISafeBox(_wrappedToken).cToken());
        return _wrappedTokenAmount.preciseMul(cToken.exchangeRateStored());
    }

    /**
     * Returns the address to approve source tokens for wrapping.
     * @param _wrappedToken         Address of the wrapped token
     * @return address              Address of the contract to approve tokens to
     */
    function getSpenderAddress(address /* _underlyingToken */, address _wrappedToken) external view returns(address) {
        return address(_wrappedToken);
    }

    /* ============ Internal Functions ============ */

    /**
     * Validates the underlying and wrapped token pair
     *
     * @param _underlyingToken     Address of the underlying asset
     * @param _wrappedToken        Address of the wrapped asset
     *
     * @return bool                Whether or not the wrapped token accepts the underlying token as collateral
     */
    function validTokenPair(address _underlyingToken, address _wrappedToken) internal view returns(bool) {
        return _underlyingToken == ETH_TOKEN_ADDRESS ? 
            ISafeBoxETH(_wrappedToken).weth() == WETH : ISafeBox(_wrappedToken).uToken() == _underlyingToken;
    }
}
