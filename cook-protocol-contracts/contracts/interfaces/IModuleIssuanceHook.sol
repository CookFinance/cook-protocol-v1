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

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { ICKToken } from "./ICKToken.sol";


/**
 * CHANGELOG:
 *      - Added a module level issue hook that can be used to set state ahead of component level
 *        issue hooks
 */
interface IModuleIssuanceHook {

    function moduleIssueHook(ICKToken _ckToken, uint256 _ckTokenQuantity) external;
    function moduleRedeemHook(ICKToken _ckToken, uint256 _ckTokenQuantity) external;
    
    function componentIssueHook(
        ICKToken _ckToken,
        uint256 _ckTokenQuantity,
        IERC20 _component,
        bool _isEquity
    ) external;

    function componentRedeemHook(
        ICKToken _ckToken,
        uint256 _ckTokenQuantity,
        IERC20 _component,
        bool _isEquity
    ) external;
}