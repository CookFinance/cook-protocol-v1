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

import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";
import { IYearnVault } from "../../../interfaces/external/IYearnVault.sol";
import { PreciseUnitMath } from "../../../lib/PreciseUnitMath.sol";

/**
 * @title YearnWrapAdapter
 * @author Cook Finance, Ember Fund
 *
 * Wrap adapter for Yearn that returns data for wraps/unwraps of tokens
 */
contract YearnVaultZapperWrapAdapter {
    using SafeMath for uint256;
    using PreciseUnitMath for uint256;
    address public constant YVAULT_ZAPIN = 0x92Be6ADB6a12Da0CA607F9d87DB2F9978cD6ec3E;
    address public constant YVAULT_ZAPOUT = 0xd6b88257e91e4E4D4E990B3A858c849EF2DFdE8c;
    address public constant ZERO_ADDRESS = 0x0000000000000000000000000000000000000000;
    address public constant ETH_TOKEN_ADDRESS = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    /* ============ Modifiers ============ */

    /**
     * Throws if the underlying/wrapped token pair is not valid
     */
    modifier _onlyValidTokenPair(address _underlyingToken, address _wrappedToken) {
        require(validTokenPair(_underlyingToken, _wrappedToken), "Must be a valid token pair");
        _;
    }

    /* ============ Constructor ============ */

    constructor() public {}

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
        _onlyValidTokenPair(_underlyingToken, _wrappedToken)
        returns (address, uint256, bytes memory)
    {
        bytes memory callData = abi.encodeWithSignature("ZapIn(address,uint256,address,address,bool,uint256,address,address,bytes,address,bool)",
                                                        _underlyingToken, _underlyingUnits, _wrappedToken, ZERO_ADDRESS, false, 0, _underlyingToken, ZERO_ADDRESS, "", ZERO_ADDRESS, false);
        return (address(YVAULT_ZAPIN), 0, callData);
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
        bytes memory callData = abi.encodeWithSignature("ZapOut(address,uint256,address,bool,uint256,address,bytes,address,bool)",
                                                        _wrappedToken, _wrappedTokenUnits, _underlyingToken, false, 0, ZERO_ADDRESS, "", ZERO_ADDRESS, false);
        return (address(YVAULT_ZAPOUT), 0, callData);
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
        _onlyValidTokenPair(_underlyingToken, _wrappedToken)
        returns (uint256)
    {
        IYearnVault yvToken = IYearnVault(_wrappedToken);
        return (_wrappedTokenAmount.add(1)).mul(yvToken.pricePerShare()).div(10**yvToken.decimals()).add(1); // mulCeil
    }

    /**
     * Get total quantity of underlying token to be returned when withdraw the wrapped token.
     *
     * @param _underlyingToken      Address of the component to be wrapped
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
        _onlyValidTokenPair(_underlyingToken, _wrappedToken)
        returns (uint256)
    {
        IYearnVault yvToken = IYearnVault(_wrappedToken);
        return _wrappedTokenAmount.mul(yvToken.pricePerShare()).div(10**yvToken.decimals());
    }

    /**
     * Returns the address to approve source tokens for wrapping.
     *
     * @return address        Address of the contract to approve tokens to
     */
    function getWrapSpenderAddress(address /* _underlyingToken */, address  _wrappedToken) external view returns(address) {
        return YVAULT_ZAPIN;
    }

    /**
     * Returns the address to approve source tokens for wrapping.
     *
     * @return address        Address of the contract to approve tokens to
     */
    function getUnwrapSpenderAddress(address /* _underlyingToken */, address  _wrappedToken) external view returns(address) {
        return YVAULT_ZAPOUT;
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
        address unwrappedToken = IYearnVault(_wrappedToken).token();
        return unwrappedToken == _underlyingToken;
    }
}