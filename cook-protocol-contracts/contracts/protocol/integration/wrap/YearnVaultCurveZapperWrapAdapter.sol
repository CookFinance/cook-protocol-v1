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

import { IYearnVault } from "../../../interfaces/external/IYearnVault.sol";
import { ICurve } from "../../../interfaces/external/ICurve.sol";
import { PreciseUnitMath } from "../../../lib/PreciseUnitMath.sol";
import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title YearnVaultCurveZapperWrapAdapter
 * @author Cook Finance
 *
 * Wrap adapter for wrapping with ycrv zapper
 */
contract YearnVaultCurveZapperWrapAdapter is Ownable {
    using SafeMath for uint256;
    using PreciseUnitMath for uint256;
    address public constant YVAULT_ZAPIN = 0x92Be6ADB6a12Da0CA607F9d87DB2F9978cD6ec3E;
    address public constant YVAULT_ZAPOUT = 0xd6b88257e91e4E4D4E990B3A858c849EF2DFdE8c;
    address public constant ZERO_ADDRESS = 0x0000000000000000000000000000000000000000;
    address public constant ETH_TOKEN_ADDRESS = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    address constant CURVE_ZAPIN = 0x5Ce9b49B7A1bE9f2c3DC2B2A5BaCEA56fa21FBeE;
    address constant CURVE_ZAPOUT = 0xE03A338d5c305613AfC3877389DD3B0617233387;

    mapping(address => address) public ycrvToCrv;

    mapping(address => address) public ycrvToCrvPools;

    /* ============== Events ============= */
    event CrvTokenAndPoolMappingsUpdated(address indexed ycrvToken, address crvToken, address crvSwapPool);

    /* ============ Modifiers ============ */

    /**
     * Throws if the underlying/wrapped token pair is not valid
     */
    modifier _onlyValidTokenPair(address _underlyingToken, address _wrappedToken) {
        require(validTokenPair(_underlyingToken, _wrappedToken), "Must be a valid token pair");
        _;
    }

    /* ============ Constructor ============ */

    constructor() public {
        ycrvToCrv[0x3B96d491f067912D18563d56858Ba7d6EC67a6fa] = 0x4f3E8F405CF5aFC05D68142F3783bDfE13811522; // yvCrvUSDN => crvUSDN
        ycrvToCrv[0x5fA5B62c8AF877CB37031e0a3B2f34A78e3C56A6] = 0xEd279fDD11cA84bEef15AF5D39BB4d4bEE23F0cA; // yvCrvLUSD => crvLUSD
        ycrvToCrv[0xA74d4B67b3368E83797a35382AFB776bAAE4F5C8] = 0x43b4FdFD4Ff969587185cDB6f0BD875c5Fc83f8c; // yvCrvALUSD => crvALUSD
        ycrvToCrv[0xB4AdA607B9d6b2c9Ee07A275e9616B84AC560139] = 0xd632f22692FaC7611d2AA1C0D552930D43CAEd3B; // yvCrvFRAX => crvFRAX
        ycrvToCrv[0x27b7b1ad7288079A66d12350c828D3C00A6F07d7] = 0x5282a4eF67D9C33135340fB3289cc1711c13638C; // yvCrvIronBank => crvIronBank
        ycrvToCrv[0x2DfB14E32e2F8156ec15a2c21c3A6c053af52Be8] = 0x5a6A4D54456819380173272A5E8E9B9904BdF41B; // ycrvMIM => crvMIM

        ycrvToCrvPools[0x3B96d491f067912D18563d56858Ba7d6EC67a6fa] =  0x0f9cb53Ebe405d49A0bbdBD291A65Ff571bC83e1; // yvCrvUSDN => crvUSDN swap pool
        ycrvToCrvPools[0x5fA5B62c8AF877CB37031e0a3B2f34A78e3C56A6] =  0xEd279fDD11cA84bEef15AF5D39BB4d4bEE23F0cA; // yvCrvLUSD => crvLUSD swap pool
        ycrvToCrvPools[0xA74d4B67b3368E83797a35382AFB776bAAE4F5C8] =  0x43b4FdFD4Ff969587185cDB6f0BD875c5Fc83f8c; // yvCrvALUSD => crvALUSD swap pool
        ycrvToCrvPools[0xB4AdA607B9d6b2c9Ee07A275e9616B84AC560139] =  0xd632f22692FaC7611d2AA1C0D552930D43CAEd3B; // yvCrvFRAX => crvFRAX swap pool
        ycrvToCrvPools[0x27b7b1ad7288079A66d12350c828D3C00A6F07d7] =  0x2dded6Da1BF5DBdF597C45fcFaa3194e53EcfeAF; // yvCrvIronBank => crvIronBank swap pool
        ycrvToCrvPools[0x2DfB14E32e2F8156ec15a2c21c3A6c053af52Be8] =  0x5a6A4D54456819380173272A5E8E9B9904BdF41B; // ycrvMIM => crvMIM swap pool
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
        returns (address, uint256, bytes memory)
    {
        address crvPool = ycrvToCrvPools[_wrappedToken];
        address crvIntermediate = ycrvToCrv[_wrappedToken];
        
        bytes memory crvZapCallData = abi.encodeWithSignature("ZapIn(address,address,address,uint256,uint256,address,bytes,address)", 
                                                        _underlyingToken, _underlyingToken, crvPool, _underlyingUnits, 0, ZERO_ADDRESS, "", ZERO_ADDRESS);

        bytes memory yvcrvZapCallData = abi.encodeWithSignature("ZapIn(address,uint256,address,address,bool,uint256,address,address,bytes,address,bool)",
                                                        _underlyingToken, _underlyingUnits, _wrappedToken, ZERO_ADDRESS, false, 0, crvIntermediate, CURVE_ZAPIN, crvZapCallData, ZERO_ADDRESS, false);
        return (address(YVAULT_ZAPIN), 0, yvcrvZapCallData);
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
        returns (address, uint256, bytes memory)
    {
        address crvPool = ycrvToCrvPools[_wrappedToken];
        IYearnVault yvToken = IYearnVault(_wrappedToken);
        uint256 crvWrappedQuantity = _wrappedTokenUnits.preciseMul(yvToken.pricePerShare());
        bytes memory crvZapCallData = abi.encodeWithSignature("ZapOut(address,uint256,address,address,uint256,address,bytes,address,bool)", 
                                                        crvPool, crvWrappedQuantity, _underlyingToken, _underlyingToken, 0, ZERO_ADDRESS, "", ZERO_ADDRESS,false);

        bytes memory yvcrvZapCallData = abi.encodeWithSignature("ZapOut(address,uint256,address,bool,uint256,address,bytes,address,bool)",
                                                        _wrappedToken, _wrappedTokenUnits, _underlyingToken, false, 0, CURVE_ZAPOUT, crvZapCallData, ZERO_ADDRESS, false);
        return (address(YVAULT_ZAPOUT), 0, yvcrvZapCallData);
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
        returns (uint256)
    {
        address crvPool = ycrvToCrvPools[_wrappedToken];
        uint256 curveVirtualPrice = ICurve(crvPool).get_virtual_price();
        uint256 ycrvVaultPrice = IYearnVault(_wrappedToken).pricePerShare();
        uint256 underlyingDecimal = ERC20(_underlyingToken).decimals();
        uint256 yVaultDecimal = ERC20(ycrvToCrv[_wrappedToken]).decimals();

        return _wrappedTokenAmount.preciseMul(ycrvVaultPrice).preciseMul(curveVirtualPrice).mul(10**underlyingDecimal).div(10**yVaultDecimal);
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

    /**
     * Update ycrv token and pool mapping
     */
    function setYCrvTokenAndPoolMappings(address ycrvToken, address crvToken, address crvSwapPool) external onlyOwner {
        ycrvToCrv[ycrvToken] = crvToken;
        ycrvToCrvPools[ycrvToken] = crvSwapPool;
        emit CrvTokenAndPoolMappingsUpdated(ycrvToken, crvToken, crvSwapPool);
    }
}
