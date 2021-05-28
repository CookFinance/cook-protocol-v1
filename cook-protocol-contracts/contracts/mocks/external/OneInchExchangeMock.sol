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

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";

// Mock contract implementation of 1Inch
contract OneInchExchangeMock {

    using SafeMath for uint256;

    address public mockReceiveToken;
    address public mockSendToken;
    uint256 public mockReceiveAmount;
    uint256 public mockSendAmount;
    // Address of CKToken which will send/receive token
    address public ckTokenAddress;

    constructor(
        address _mockSendToken,
        address _mockReceiveToken,
        uint256 _mockSendAmount,
        uint256 _mockReceiveAmount
    ) public {
        mockSendToken = _mockSendToken;
        mockReceiveToken = _mockReceiveToken;
        mockSendAmount = _mockSendAmount;
        mockReceiveAmount = _mockReceiveAmount;
    }

    // Initialize CKToken address which will send/receive tokens for the trade
    function addCKTokenAddress(address _ckTokenAddress) external {
        ckTokenAddress = _ckTokenAddress;
    }

    // Conform to 1Inch Swap interface
    function swap(
        address _fromToken,
        address _toToken,
        uint256 _fromTokenAmount,
        uint256 _minReturnAmount,
        uint256 _guaranteedAmount,
        address payable _referrer,
        address[] calldata _callAddresses,
        bytes calldata _callDataConcat,
        uint256[] calldata _starts,
        uint256[] calldata _gasLimitsAndValues
    )
        external
        payable
        returns (uint256 returnAmount)
    {
        require(ERC20(mockSendToken).transferFrom(ckTokenAddress, address(this), mockSendAmount), "ERC20 TransferFrom failed");
        require(ERC20(mockReceiveToken).transfer(ckTokenAddress, mockReceiveAmount), "ERC20 transfer failed");

        // Used to silence compiler warnings
        _fromToken;
        _toToken;
        _fromTokenAmount;
        _minReturnAmount;
        _guaranteedAmount;
        _referrer;
        _callAddresses;
        _callDataConcat;
        _starts;
        _gasLimitsAndValues;

        return mockReceiveAmount;
    }
}