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
import { IWMemo } from "../../../interfaces/external/IWMemo.sol";
import { ITimeStaking } from "../../../interfaces/external/ITimeStaking.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { PreciseUnitMath } from "../../../lib/PreciseUnitMath.sol";

/**
 * @title WMEMOStakeAdapter
 * @author Cook Finance, Ember Fund
 *
 * Wrap adapter for zap/unZap of TIME (WMEMO)
 */
contract WMEMOStakeAdapter is Ownable {
    using SafeERC20 for IERC20;
    using SafeMath for uint256;
    using PreciseUnitMath for uint256;

    address public constant ETH_TOKEN_ADDRESS = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;
    address public constant TIME_STAKER = 0x4456B87Af11e87E329AB7d7C7A246ed1aC2168B9;
    address public constant MEMO_WRAPPER = 0x0da67235dD5787D67955420C84ca1cEcd4E5Bb3b;

    address public constant TIME = 0xb54f16fB19478766A268F172C9480f8da1a7c9C3;
    address public constant MEMO = 0x136Acd46C134E8269052c62A67042D6bDeDde3C9;
    address public constant WMemo = 0x0da67235dD5787D67955420C84ca1cEcd4E5Bb3b;


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
        bytes memory callData = abi.encodeWithSignature("timeZapperToWMemp(uint256)", _underlyingUnits);
        return (address(this), 0, callData);
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
        bytes memory callData = abi.encodeWithSignature("timeUnZapper(uint256)", _wrappedTokenUnits);
        return (address(this), 0, callData);
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
        IWMemo wMemo = IWMemo(WMemo);
        return wMemo.wMEMOToMEMO(_wrappedTokenAmount);
    }

    /**
     * Returns the address to approve source tokens for wrapping. (Use this if wrap/unwrap is different address)
     *
     * @return address        Address of the contract to approve tokens to
     */
    function getWrapSpenderAddress(address /* _underlyingToken */, address  _wrappedToken) external view returns(address) {
        return address(this);
    }

    /**
     * Returns the address to approve source tokens for unwrapping. (Use this if wrap/unwrap is different address)
     *
     * @return address        Address of the contract to approve tokens to
     */
    function getUnwrapSpenderAddress(address /* _underlyingToken */, address  _wrappedToken) external view returns(address) {
        return address(this);
    }

    /**
     * Returns the address to approve source tokens for wrapping. (Use this if wrap/unwrap is the same address)
     *
     * @return address        Address of the contract to approve tokens to
     */
    function getSpenderAddress(address /* _underlyingToken */, address  _wrappedToken) external view returns(address) {
        return address(this);
    }

    function timeZapperToWMemp(uint256 _amount) external {
        // stake time -> memo
        SafeERC20.safeTransferFrom(IERC20(TIME), msg.sender, address(this), _amount);
        IERC20(TIME).approve(TIME_STAKER, _amount);
        ITimeStaking(TIME_STAKER).stake( _amount, address(this));
        ITimeStaking(TIME_STAKER).claim(address(this));

        // wrap memo -> wMemp
        uint256 memoBal = IERC20(MEMO).balanceOf(address(this));
        IERC20(MEMO).approve(WMemo, _amount);
        IWMemo(WMemo).wrap(memoBal);
        uint256 wMemoBal = IERC20(WMemo).balanceOf(address(this));
        SafeERC20.safeTransfer(IERC20(WMemo), msg.sender, wMemoBal);
    }

    function timeUnZapper(uint256 _amount) external {
        // unwrap wMemop -> memo
        SafeERC20.safeTransferFrom(IERC20(WMemo), msg.sender, address(this), _amount);
        IERC20(WMemo).approve(WMemo, _amount);
        IWMemo(WMemo).unwrap(_amount);

        // unstake memo -> time
        uint256 memoBal = IERC20(MEMO).balanceOf(address(this));
        IERC20(MEMO).approve(TIME_STAKER, memoBal);
        ITimeStaking(TIME_STAKER).unstake(memoBal, true);
        uint256 timeBal = IERC20(TIME).balanceOf(address(this));
        SafeERC20.safeTransfer(IERC20(TIME), msg.sender, timeBal);
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
        return _underlyingToken == TIME && _wrappedToken == WMemo;
    }
}
