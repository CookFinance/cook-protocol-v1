/*
    Copyright 2018 Cook Finance.

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

/**
 * @title IWETH
 * @author Cook Finance
 *
 * To Stake Time token (from wonderland) and get back Memo
 */
interface ITimeStaking {
    function stake( uint _amount, address _recipient ) external returns ( bool );
    function unstake( uint _amount, bool _trigger ) external;
    function claim ( address _recipient ) external;

    function rebase() external;
    function contractBalance() external view returns ( uint );
    function giveLockBonus( uint _amount ) external;
    function returnLockBonus( uint _amount ) external;
}