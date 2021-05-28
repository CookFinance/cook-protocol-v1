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

import { IController } from "../../../interfaces/IController.sol";
import { ICKToken } from "../../../interfaces/ICKToken.sol";
import { ModuleBase } from "../../../protocol/lib/ModuleBase.sol";

contract ModuleBaseMock is ModuleBase {

    bool public removed;

    constructor(IController _controller) public ModuleBase(_controller) {}

    /* ============ External Functions ============ */

    function testTransferFrom(IERC20 _token, address _from, address _to, uint256 _quantity) external {
        return transferFrom(_token, _from, _to, _quantity);
    }


    function testIsCKPendingInitialization(ICKToken _ckToken) external view returns(bool) {
        return isCKPendingInitialization(_ckToken);
    }

    function testIsCKManager(ICKToken _ckToken, address _toCheck) external view returns(bool) {
        return isCKManager(_ckToken, _toCheck);
    }

    function testIsCKValidAndInitialized(ICKToken _ckToken) external view returns(bool) {
        return isCKValidAndInitialized(_ckToken);
    }

    function testOnlyManagerAndValidCK(ICKToken _ckToken)
        external
        view
        onlyManagerAndValidCK(_ckToken)
    {}

    function testGetAndValidateAdapter(string memory _integrationName) external view returns(address) {
        return getAndValidateAdapter(_integrationName);
    }

    function testGetAndValidateAdapterWithHash(bytes32 _integrationHash) external view returns(address) {
        return getAndValidateAdapterWithHash(_integrationHash);
    }

    function testGetModuleFee(uint256 _feeIndex, uint256 _quantity) external view returns(uint256) {
        return getModuleFee(_feeIndex, _quantity);
    }

    function testPayProtocolFeeFromCKToken(
        ICKToken _ckToken,
        address _component,
        uint256 _feeQuantity
    ) external {
        payProtocolFeeFromCKToken(_ckToken, _component, _feeQuantity);
    }

    function testOnlyCKManager(ICKToken _ckToken)
        external
        view
        onlyCKManager(_ckToken, msg.sender)
    {}

    function testOnlyModule(ICKToken _ckToken)
        external
        view
        onlyModule(_ckToken)
    {}


    function removeModule() external override {
        removed = true;
    }

    function testOnlyValidAndInitializedCK(ICKToken _ckToken)
        external view onlyValidAndInitializedCK(_ckToken) {}

    function testOnlyValidInitialization(ICKToken _ckToken)
        external view onlyValidAndPendingCK(_ckToken) {}

    /* ============ Helper Functions ============ */

    function initializeModuleOnCK(ICKToken _ckToken) external {
        _ckToken.initializeModule();
    }
}