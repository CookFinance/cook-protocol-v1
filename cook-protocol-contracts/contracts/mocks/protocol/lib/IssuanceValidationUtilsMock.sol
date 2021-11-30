/*
    Copyright 2021 Cook Finance

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

import { ICKToken } from "../../../interfaces/ICKToken.sol";
import { IssuanceValidationUtils } from "../../../protocol/lib/IssuanceValidationUtils.sol";

contract IssuanceValidationUtilsMock {
    /* ============ External Functions ============ */

    function testValidateCollateralizationPostTransferInPreHook(
        ICKToken _ckToken, 
        address _component, 
        uint256 _initialCKSupply,
        uint256 _componentQuantity
    )
        external
        view
    {
        IssuanceValidationUtils.validateCollateralizationPostTransferInPreHook(
            _ckToken, 
            _component, 
            _initialCKSupply,
            _componentQuantity
        );
    }

    function testValidateCollateralizationPostTransferOut(
        ICKToken _ckToken, 
        address _component,
        uint256 _finalCKSupply
    ) 
        external
        view
    {
        IssuanceValidationUtils.validateCollateralizationPostTransferOut(
            _ckToken, 
            _component, 
            _finalCKSupply
        );
    }
}