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

import { Address } from "@openzeppelin/contracts/utils/Address.sol";
import { ICKToken } from "../interfaces/ICKToken.sol";
import { AddressArrayUtils } from "../lib/AddressArrayUtils.sol";
import { MutualUpgrade } from "../lib/MutualUpgrade.sol";

/**
 * @title ICManagerV2
 * @author Cook Finance
 *
 * Smart contract manager that contains permissions and admin functionality
 */
contract ICManagerV2 is MutualUpgrade {
    using Address for address;
    using AddressArrayUtils for address[];

    /* ============ Events ============ */

    event AdapterAdded(
        address _adapter
    );

    event AdapterRemoved(
        address _adapter
    );

    event MethodologistChanged(
        address _oldMethodologist,
        address _newMethodologist
    );

    event OperatorChanged(
        address _oldOperator,
        address _newOperator
    );

    /* ============ Modifiers ============ */

    /**
     * Throws if the sender is not the CKToken operator
     */
    modifier onlyOperator() {
        require(msg.sender == operator, "Must be operator");
        _;
    }

    /**
     * Throws if the sender is not the CKToken methodologist
     */
    modifier onlyMethodologist() {
        require(msg.sender == methodologist, "Must be methodologist");
        _;
    }

    /**
     * Throws if the sender is not a listed adapter
     */
    modifier onlyAdapter() {
        require(isAdapter[msg.sender], "Must be adapter");
        _;
    }

    /* ============ State Variables ============ */

    // Instance of CKToken
    ICKToken public ckToken;

    // Array of listed adapters
    address[] internal adapters;

    // Mapping to check if adapter is added
    mapping(address => bool) public isAdapter;

    // Address of operator which typically executes manager only functions on Cook Finance modules
    address public operator;

    // Address of methodologist which serves as providing methodology for the index
    address public methodologist;

    // Indicates whether manager has been initialized
    bool public initialized;

    /* ============ Constructor ============ */

    constructor(
        ICKToken _ckToken,
        address _operator,
        address _methodologist
    )
        public
    {
        ckToken = _ckToken;
        operator = _operator;
        methodologist = _methodologist;
    }

    /* ============ External Functions ============ */

    /**
     * OPEERATOR ONLY: Initialize manager by passing in array of valid adapters. Only callable once. All new adapters must be added
     * through mutual upgrade.
     *
     * @param _adapters           Array of adapters to add to manager
     */
    function initializeAdapters(address[] memory _adapters) external onlyOperator {
        require(!initialized, "Manager already initialized");

        for (uint256 i = 0; i < _adapters.length; i++) {
            require(!isAdapter[_adapters[i]], "Adapter already exists");

            isAdapter[_adapters[i]] = true;
        }
        adapters = _adapters;
        initialized = true;
    }

    /**
     * MUTUAL UPGRADE: Update the CKToken manager address. Operator and Methodologist must each call
     * this function to execute the update.
     *
     * @param _newManager           New manager address
     */
    function setManager(address _newManager) external mutualUpgrade(operator, methodologist) {
        ckToken.setManager(_newManager);
    }

    /**
     * MUTUAL UPGRADE: Add a new adapter that the ICManagerV2 can call.
     *
     * @param _adapter           New adapter to add
     */
    function addAdapter(address _adapter) external mutualUpgrade(operator, methodologist) {
        require(!isAdapter[_adapter], "Adapter already exists");

        adapters.push(_adapter);

        isAdapter[_adapter] = true;

        emit AdapterAdded(_adapter);
    }

    /**
     * MUTUAL UPGRADE: Remove an existing adapter tracked by the ICManagerV2.
     *
     * @param _adapter           Old adapter to remove
     */
    function removeAdapter(address _adapter) external mutualUpgrade(operator, methodologist) {
        require(isAdapter[_adapter], "Adapter does not exist");

        adapters = adapters.remove(_adapter);

        isAdapter[_adapter] = false;

        emit AdapterRemoved(_adapter);
    }

    /**
     * ADAPTER ONLY: Interact with a module registered on the CKToken.
     *
     * @param _module           Module to interact with
     * @param _data             Byte data of function to call in module
     */
    function interactModule(address _module, bytes calldata _data) external onlyAdapter {
        // Invoke call to module, assume value will always be 0
        _module.functionCallWithValue(_data, 0);
    }

    /**
     * OPERATOR ONLY: Add a new module to the CKToken.
     *
     * @param _module           New module to add
     */
    function addModule(address _module) external onlyOperator {
        ckToken.addModule(_module);
    }

    /**
     * OPERATOR ONLY: Remove a new module from the CKToken.
     *
     * @param _module           Module to remove
     */
    function removeModule(address _module) external onlyOperator {
        ckToken.removeModule(_module);
    }

    /**
     * METHODOLOGIST ONLY: Update the methodologist address
     *
     * @param _newMethodologist           New methodologist address
     */
    function setMethodologist(address _newMethodologist) external onlyMethodologist {
        emit MethodologistChanged(methodologist, _newMethodologist);

        methodologist = _newMethodologist;
    }

    /**
     * OPERATOR ONLY: Update the operator address
     *
     * @param _newOperator           New operator address
     */
    function setOperator(address _newOperator) external onlyOperator {
        emit OperatorChanged(operator, _newOperator);

        operator = _newOperator;
    }

    function getAdapters() external view returns(address[] memory) {
        return adapters;
    }
}