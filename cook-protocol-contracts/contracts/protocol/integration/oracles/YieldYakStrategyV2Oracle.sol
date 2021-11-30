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

import { PreciseUnitMath } from "../../../lib/PreciseUnitMath.sol";
import { IYieldYakStrategyV2 } from "../../../interfaces/external/IYieldYakStrategyV2.sol";
import { IOracle } from "../../../interfaces/IOracle.sol";


/**
 * @title YieldYakStrategyV2Oracle
 * @author Cook Finance
 *
 * Oracle built to retrieve the YieldYakStrategyV2 price
 */
contract YieldYakStrategyV2Oracle is IOracle
{
    using SafeMath for uint256;
    using PreciseUnitMath for uint256;


    /* ============ State Variables ============ */
    IYieldYakStrategyV2 public immutable yieldYakStrategyV2;
    IOracle public immutable underlyingOracle; // Underlying token oracle
    uint256 public underlyingTokenDecimals;
    string public dataDescription;

    /* ============ Constructor ============ */

    /*
     * @param  _vault               The address of IYieldYakStrategyV2
     * @param  _underlyingOracle    The address of the underlying oracle
     * @param  _dataDescription     Human readable description of oracle
     */
    constructor(
        IYieldYakStrategyV2 _yieldYakStrategyV2,
        IOracle _underlyingOracle,
        uint256 _underlyingTokenDecimals,
        string memory _dataDescription
    )
        public
    {
        yieldYakStrategyV2 = _yieldYakStrategyV2;
        underlyingOracle = _underlyingOracle;
        underlyingTokenDecimals = _underlyingTokenDecimals;
        dataDescription = _dataDescription;
    }

    /**
     * Returns the price value of a full vault token denominated in underlyingOracle value.
     * The derived price of the vault token is the price of a share multiplied divided by
     * underlying full unit and multiplied by the underlying price.
     */
    function read()
        external
        override
        view
        returns (uint256)
    {
        // Retrieve the price of the underlying
        uint256 underlyingPrice = underlyingOracle.read();

        // Price per share is the amount of the underlying asset per 1 full vaultToken
        uint256 underlyingPerShare = yieldYakStrategyV2.getDepositTokensForShares(10 ** underlyingTokenDecimals);

        return underlyingPerShare.mul(underlyingPrice).div(10 ** underlyingTokenDecimals);
    }
}
