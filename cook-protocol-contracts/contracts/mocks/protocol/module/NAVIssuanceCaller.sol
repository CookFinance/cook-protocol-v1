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

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { INAVIssuanceModule } from "../../../interfaces/INAVIssuanceModule.sol";
import { ICKToken } from "../../../interfaces/ICKToken.sol";


contract NAVIssuanceCaller {
    INAVIssuanceModule public navIssuance;

    constructor(INAVIssuanceModule _navIssuance) public { navIssuance = _navIssuance; }

    function issue(
        ICKToken _ckToken,
        address _reserveAsset,
        uint256 _reserveAssetQuantity,
        uint256 _minCKTokenReceiveQuantity,
        address _to
    ) 
        external
    {
        IERC20(_reserveAsset).approve(address(navIssuance), _reserveAssetQuantity);
        navIssuance.issue(
            _ckToken,
            _reserveAsset,
            _reserveAssetQuantity,
            _minCKTokenReceiveQuantity,
            _to
        );
    }

    function redeem(
        ICKToken _ckToken,
        address _reserveAsset,
        uint256 _ckTokenQuantity,
        uint256 _minReserveReceiveQuantity,
        address _to
    ) 
        external
    {
        navIssuance.redeem(
            _ckToken,
            _reserveAsset,
            _ckTokenQuantity,
            _minReserveReceiveQuantity,
            _to
        );
    }
}