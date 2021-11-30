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

import { ICKToken } from "./ICKToken.sol";

interface IIssuanceModule {

    function issue(ICKToken _ckToken, uint256 _quantity, address _to) external;
    function redeem(ICKToken _ckToken, uint256 _quantity, address _to) external;    
    function issueWithSingleToken(ICKToken _ckToken, address _issueToken, uint256 _issueTokenQuantity, uint256 _slippageReserve,address _to, bool _returnDust) external;
    function issueWithSingleToken2 (ICKToken _ckToken, address _issueToken, uint256 _issueTokenQuantity, uint256 _minCkTokenRec, uint256[] memory _weightings, address _to, bool _returnDust) external;
    function redeemToSingleToken(ICKToken _ckToken, uint256 _ckTokenQuantity, address _redeemToken, address _to) external;
}