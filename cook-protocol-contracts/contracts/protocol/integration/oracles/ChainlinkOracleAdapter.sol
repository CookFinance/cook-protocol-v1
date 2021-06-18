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
*/

pragma solidity 0.6.10;

import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";
import { AggregatorV3Interface } from "@chainlink/contracts/src/v0.6/interfaces/AggregatorV3Interface.sol";


/**
 * @title ChainlinkOracleAdapter
 * @author Cook Finance
 *
 * Coerces outputs from Chainlink oracles to uint256 and adapts value to 18 decimals.
 */
contract ChainlinkOracleAdapter {
    using SafeMath for uint256;

    /* ============ State Variables ============ */
    AggregatorV3Interface public oracle;
    uint256 public priceMultiplier;

    /* ============ Constructor ============ */
    /*
     * Set address of aggregator being adapted for use. Different oracles return prices with different decimals.
     * In this iteration of ChainLinkOracleAdapter, we allow the deployer to specify the multiple decimal
     * to pass into the contract
     *
     * @param  _oracle                  The address of medianizer being adapted from bytes to uint256
     * @param  _priceMultiplierDecimals Decimal places to convert 
     */
    constructor(
        AggregatorV3Interface _oracle,
        uint256 _priceMultiplierDecimals
    )
        public
    {
        oracle = _oracle;
        priceMultiplier = 10 ** _priceMultiplierDecimals;
    }

    /* ============ External ============ */

    /*
     * Reads value of oracle and coerces return to uint256 then applies price multiplier
     *
     * @returns         Chainlink oracle price in uint256
     */
    function read()
        external
        view
        returns (uint256)
    {
        // Read value of medianizer and coerce to uint256
       (,int price,,,) = oracle.latestRoundData();

        // Apply multiplier to create 18 decimal price (since Chainlink returns 8 decimals)
        return uint256(price).mul(priceMultiplier);
    }
}
