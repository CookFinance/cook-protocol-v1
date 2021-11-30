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

import { PreciseUnitMath } from "../../../lib/PreciseUnitMath.sol";
import { IYearnVault } from "../../../interfaces/external/IYearnVault.sol";
import { IOracle } from "../../../interfaces/IOracle.sol";
import { ICurve } from "../../../interfaces/external/ICurve.sol";


/**
 * @title YearnVaultOracle
 * @author Cook Finance, Ember Fund
 *
 * Oracle built to retrieve the Yearn vault price
 */
contract YearnCurveVaultOracle is IOracle
{
    using SafeMath for uint256;
    using PreciseUnitMath for uint256;


    /* ============ State Variables ============ */
    IYearnVault public immutable vault;
    ICurve public immutable crvPool;

    IOracle public immutable underlyingOracle; // Underlying token oracle
    string public dataDescription;

    // Underlying Asset Full Unit
    uint256 public immutable underlyingFullUnit;

    /* ============ Constructor ============ */

    /*
     * @param  _vault               The address of Yearn Vault Token
     * @param  _curvePool           The address of Curve swap pool
     * @param  _underlyingOracle    The address of the underlying oracle
     * @param  _underlyingFullUnit  The full unit of the underlying asset
     * @param  _dataDescription     Human readable description of oracle
     */
    constructor(
        IYearnVault _vault,
        ICurve _curvePool,
        IOracle _underlyingOracle,
        uint256 _underlyingFullUnit,
        string memory _dataDescription
    )
        public
    {
        vault = _vault;
        crvPool = _curvePool;
        underlyingFullUnit = _underlyingFullUnit;
        underlyingOracle = _underlyingOracle;
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

        uint256 curveVirtualPrice = crvPool.get_virtual_price();

        // Price per share is the amount of the underlying asset per 1 full vaultToken
        uint256 yvTokenPrice = vault.pricePerShare();

    
        return yvTokenPrice.mul(curveVirtualPrice).div(10**18).mul(underlyingPrice).div(10**18);
    }
}
