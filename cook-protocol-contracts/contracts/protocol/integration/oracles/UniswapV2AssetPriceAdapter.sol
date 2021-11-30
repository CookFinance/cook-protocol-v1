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

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import "../../../interfaces/IController.sol";
import "../../../interfaces/external/IUniswapV2Pair.sol";
import "../../../interfaces/external/IUniswapV2Factory.sol";
import "../../../lib/PreciseUnitMath.sol";
import { UniswapV2Library } from "../../../../external/contracts/uniswap/v2/lib/UniswapV2Library.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract UniswapV2AssetPriceAdapter is Ownable {
    using PreciseUnitMath for uint256;
    using PreciseUnitMath for uint;

    /* ============ State Variables ============ */

    // Instance of the Controller contract
    IController public controller;

    // Address of Uniswap V2 factory
    IUniswapV2Factory public uniswapV2Factory;

    /* ============ Constructor ============ */

    /**
     * Set state variables
     *
     * @param _controller         Instance of controller contract
     * @param _uniswapFactory     Address of Uniswap factory
     */
    constructor(
        IController _controller,
        IUniswapV2Factory _uniswapFactory
    )
        public
    {
        controller = _controller;
        uniswapV2Factory = _uniswapFactory;
    }

    /* ============ External Functions ============ */

    /**
     * Calculate price from Uniswap. Note: must be system contract to be able to retrieve price. If pair not exist, return false.
     *
     * @param _assetOne         Address of first asset in pair
     * @param _assetTwo         Address of second asset in pair
     */
    function getPrice(address _assetOne, address _assetTwo) external view returns (bool, uint256) {
        require(controller.isSystemContract(msg.sender), "Must be system contract");
        address pairAddress = uniswapV2Factory.getPair(_assetOne, _assetTwo);
        // return 0 if the pair doesn't exist
        if (pairAddress == address(0)) {
            return (false, 0);
        }
        IUniswapV2Pair pair = IUniswapV2Pair(pairAddress);
        (uint256 token0Reserves, uint256 token1Reserves) = UniswapV2Library.getReserves(address(uniswapV2Factory), _assetOne, _assetTwo);
        uint256 normalizedToken0Reserves = token0Reserves.preciseDiv(uint256(10).safePower(uint256(ERC20(pair.token0()).decimals())));
        uint256 normalizedToken1Reserves = token1Reserves.preciseDiv(uint256(10).safePower(uint256(ERC20(pair.token1()).decimals())));
        if (_assetOne == pair.token0()) {
            return (true, normalizedToken1Reserves.preciseDiv(normalizedToken0Reserves));
        } else {
            return (true, normalizedToken0Reserves.preciseDiv(normalizedToken1Reserves));
        }
    }
}
