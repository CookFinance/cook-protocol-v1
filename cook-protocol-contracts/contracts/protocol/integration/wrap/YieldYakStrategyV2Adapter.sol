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
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { IYieldYakStrategyV2 } from "../../../interfaces/external/IYieldYakStrategyV2.sol";
import { PreciseUnitMath } from "../../../lib/PreciseUnitMath.sol";

/**
 * @title YearnWrapAdapter
 * @author Cook Finance, Ember Fund
 *
 * Wrap adapter for Yearn that returns data for wraps/unwraps of tokens
 */
contract YieldYakStrategyV2Adapter is Ownable {
    using SafeMath for uint256;
    using PreciseUnitMath for uint256;
    address public constant ETH_TOKEN_ADDRESS = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    struct YakStrategyConfig {
        address depositToken;
        uint8 decimals;
    }

    mapping(address => YakStrategyConfig) yakStrategyConfigs;
    
    event StrategyConfigUpdate(address Strategy, address depositToken, uint8 decimals);

    /* ============ Modifiers ============ */

    /**
     * Throws if the underlying/wrapped token pair is not valid
     */
    modifier _onlyValidTokenPair(address _underlyingToken, address _wrappedToken) {
        require(validTokenPair(_underlyingToken, _wrappedToken), "Must be a valid token pair");
        _;
    }

    /* ============ Constructor ============ */

    constructor() public { }

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
        bytes memory callData = abi.encodeWithSignature("deposit(uint256)", _underlyingUnits);
        return (address(_wrappedToken), 0, callData);
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
        bytes memory callData = abi.encodeWithSignature("withdraw(uint256)", _wrappedTokenUnits);
        return (address(_wrappedToken), 0, callData);
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
        IYieldYakStrategyV2 yakERC20 = IYieldYakStrategyV2(_wrappedToken);
        uint8 decimals = yakStrategyConfigs[_wrappedToken].decimals;
        return yakERC20.getDepositTokensForShares(_wrappedTokenAmount);
    }

    /**
     * Returns the address to approve source tokens for wrapping. (Use this if wrap/unwrap is different address)
     *
     * @return address        Address of the contract to approve tokens to
     */
    function getWrapSpenderAddress(address /* _underlyingToken */, address  _wrappedToken) external view returns(address) {
        return address(_wrappedToken);
    }

    /**
     * Returns the address to approve source tokens for unwrapping. (Use this if wrap/unwrap is different address)
     *
     * @return address        Address of the contract to approve tokens to
     */
    function getUnwrapSpenderAddress(address /* _underlyingToken */, address  _wrappedToken) external view returns(address) {
        return address(_wrappedToken);
    }

    /**
     * Returns the address to approve source tokens for wrapping. (Use this if wrap/unwrap is the same address)
     *
     * @return address        Address of the contract to approve tokens to
     */
    function getSpenderAddress(address /* _underlyingToken */, address  _wrappedToken) external view returns(address) {
        return address(_wrappedToken);
    }

    /**
     * Update config information for an Yak Strategy
     */
    function updateYakStrategyConfig(address yakStrategyV2, YakStrategyConfig memory _config) external onlyOwner {
        yakStrategyConfigs[yakStrategyV2] = _config;
        emit StrategyConfigUpdate(yakStrategyV2, _config.depositToken, _config.decimals);
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
        address unwrappedToken = yakStrategyConfigs[_wrappedToken].depositToken;
        return unwrappedToken == _underlyingToken;
    }
}
