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


import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { ICKToken } from "../interfaces/ICKToken.sol";


/**
 * @title CKTokenViewer
 * @author Cook Finance
 *
 * CKTokenViewer enables batch queries of CKToken state.
 *
 * UPDATE:
 * - Added getCKDetails functions
 */
contract CKTokenViewer {

    struct CKDetails {
        string name;
        string symbol;
        address manager;
        address[] modules;
        ICKToken.ModuleState[] moduleStatuses;
        ICKToken.Position[] positions;
        uint256 totalSupply;
    }

    function batchFetchManagers(
        ICKToken[] memory _ckTokens
    )
        external
        view
        returns (address[] memory) 
    {
        address[] memory managers = new address[](_ckTokens.length);

        for (uint256 i = 0; i < _ckTokens.length; i++) {
            managers[i] = _ckTokens[i].manager();
        }
        return managers;
    }

    function batchFetchModuleStates(
        ICKToken[] memory _ckTokens,
        address[] calldata _modules
    )
        public
        view
        returns (ICKToken.ModuleState[][] memory)
    {
        ICKToken.ModuleState[][] memory states = new ICKToken.ModuleState[][](_ckTokens.length);
        for (uint256 i = 0; i < _ckTokens.length; i++) {
            ICKToken.ModuleState[] memory moduleStates = new ICKToken.ModuleState[](_modules.length);
            for (uint256 j = 0; j < _modules.length; j++) {
                moduleStates[j] = _ckTokens[i].moduleStates(_modules[j]);
            }
            states[i] = moduleStates;
        }
        return states;
    }

    function batchFetchDetails(
        ICKToken[] memory _ckTokens,
        address[] calldata _moduleList
    )
        public
        view
        returns (CKDetails[] memory)
    {
        ICKToken.ModuleState[][] memory moduleStates = batchFetchModuleStates(_ckTokens, _moduleList);

        CKDetails[] memory details = new CKDetails[](_ckTokens.length);
        for (uint256 i = 0; i < _ckTokens.length; i++) {
            ICKToken ckToken = _ckTokens[i];

            details[i] = CKDetails({
                name: ERC20(address(ckToken)).name(),
                symbol: ERC20(address(ckToken)).symbol(),
                manager: ckToken.manager(),
                modules: ckToken.getModules(),
                moduleStatuses: moduleStates[i],
                positions: ckToken.getPositions(),
                totalSupply: ckToken.totalSupply()
            });
        }
        return details;
    }

    function getCKDetails(
        ICKToken _ckToken,
        address[] calldata _moduleList
    )
        external
        view
        returns(CKDetails memory)
    {
        ICKToken[] memory ckAddressForBatchFetch = new ICKToken[](1);
        ckAddressForBatchFetch[0] = _ckToken;

        return batchFetchDetails(ckAddressForBatchFetch, _moduleList)[0];
    }
}