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

import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";

import { IVenusToken } from "../../../interfaces/external/IVenusToken.sol";
import { PreciseUnitMath } from "../../../lib/PreciseUnitMath.sol";

/**
 * @title VenusWrapAdapater
 * @author Cook Finance
 *
 * Wrap adapter for Venus that returns data for wrap/unwraps of tokens .
 */
contract VenusWrapAdapater {
    using SafeMath for uint256;
    using PreciseUnitMath for uint256;

     /* ============ Constants ============ */

    address public constant ETH_TOKEN_ADDRESS = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;
    address public immutable vBNB = 0xA07c5b74C9B40447a954e1466938b865b6BBea36;

    /* ============ Constructor ============ */

    constructor() public {}


     /* ============ Modifiers ============ */

    /**
     * Throws if the underlying/wrapped token pair is not valid
     */
    modifier _onlyValidTokenPair(address _underlyingToken, address _wrappedToken) {
        require(validTokenPair(_underlyingToken, _wrappedToken), "Must be a valid token pair");
        _;
    }

    /* ============ External Getter Functions ============ */

    /**
     * Calculate the underlying units to get the desired wrapped units
     *
     * @param _underlyingToken      Address of the component to be wrapped
     * @param _wrappedToken         Address of the desired wrapped token
     * @param _wrappedAmount        Total quantity of wrapped token units
     *
     * @return uint256              Total quantity of underlying units 
     */
    function getDepositUnderlyingTokenAmount(
        address _underlyingToken, 
        address _wrappedToken, 
        uint256 _wrappedAmount
    ) 
        external 
        view 
         _onlyValidTokenPair(_underlyingToken, _wrappedToken)
        returns(uint256) 
    {
        if(_wrappedAmount == 0) {
            return 0;
        }

        IVenusToken venusToken = IVenusToken(_wrappedToken);
        uint256 exchangeRateStored = venusToken.exchangeRateStored();

        uint256 underlyingTokenAmount = _wrappedAmount.preciseMul(exchangeRateStored);

        return underlyingTokenAmount;
    }

    /**
     * Returns the address to approve source tokens for wrapping.
     *
     * @return address        Address of the contract to approve tokens to
     */
    function getSpenderAddress(address /* _underlyingToken */, address _wrappedToken) external view returns(address) {
        return _wrappedToken;
    }

    /**
     * Returns the address to approve source tokens for wrapping.
     *
     * @return address        Address of the contract to approve tokens to wrap
     */
    function getWrapSpenderAddress(address /* _underlyingToken */, address _wrappedToken) external view returns(address) {
        return _wrappedToken;
    }

    /**
     * Returns the address to approve source tokens for unwrapping.
     *
     * @return address        Address of the contract to approve tokens to unwrap
     */
    function getUnwrapSpenderAddress(address /* _underlyingToken */, address _wrappedToken) external view returns(address) {
        return _wrappedToken;
    }

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
         _onlyValidTokenPair(_underlyingToken, _wrappedToken)
        returns (address, uint256, bytes memory)
    {
        uint256 value;
        bytes memory callData;
        if (_underlyingToken == ETH_TOKEN_ADDRESS) {
            value = _underlyingUnits;
            callData = abi.encodeWithSignature("mint()");
        } else {
            value = 0;
            callData = abi.encodeWithSignature("mint(uint256)", _underlyingUnits);
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
         _onlyValidTokenPair(_underlyingToken, _wrappedToken)
        returns (address, uint256, bytes memory)
    {

        bytes memory callData = abi.encodeWithSignature("redeem(uint256)", _wrappedTokenUnits);
        return (_wrappedToken, 0, callData);
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
        IVenusToken venusToken = IVenusToken(_wrappedToken);
        require(venusToken.isVToken(), "Must be Venus Token!");
        address toCheck = _wrappedToken == address(vBNB) ? ETH_TOKEN_ADDRESS : venusToken.underlying();
        return _underlyingToken == toCheck;
    }
}