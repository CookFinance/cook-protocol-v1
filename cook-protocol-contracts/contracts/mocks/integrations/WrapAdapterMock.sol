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
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";


/**
 * @title WrapAdapterMock
 * @author Cook Finance
 *
 * ERC20 contract that doubles as a wrap token. The wrapToken accepts any underlying token and
 * mints/burns the WrapAdapter Token.
 */
contract WrapAdapterMock is ERC20 {

    address public constant ETH_TOKEN_ADDRESS = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    /* ============ Constructor ============ */
    constructor() public ERC20("WrapAdapter", "WRAP") {}

    /* ============ External Functions ============ */

    /**
     * Mints tokens to the sender of the underlying quantity
     */
    function deposit(address _underlyingToken, uint256 _underlyingQuantity) payable external {
        // Do a transferFrom of the underlyingToken
        uint256 unitDecimals = 1;
        if (_underlyingToken != ETH_TOKEN_ADDRESS) {
            unitDecimals = 10 ** (18 - uint256(ERC20(_underlyingToken).decimals()));
            IERC20(_underlyingToken).transferFrom(msg.sender, address(this), _underlyingQuantity);
        }

        _mint(msg.sender, _underlyingQuantity * unitDecimals);
    }

    /**
     * Burns tokens from the sender of the wrapped asset and returns the underlying
     */
    function withdraw(address _underlyingToken, uint256 _wrappedQuantity) external {
        // Transfer the underlying to the sender
        if (_underlyingToken == ETH_TOKEN_ADDRESS) {
            msg.sender.transfer(_wrappedQuantity);
        } else {
            uint256 unitDecimals = ERC20(_underlyingToken).decimals();
            IERC20(_underlyingToken).transfer(msg.sender, _wrappedQuantity / (10 ** (18 - unitDecimals)));
        }

        _burn(msg.sender, _wrappedQuantity);
    }

    /**
     * [x]
     */
    function getWrapCallData(
        address _underlyingToken,
        address /* _wrappedToken */,
        uint256 _underlyingUnits
    ) external view returns (address _subject, uint256 _value, bytes memory _calldata) {
        uint256 value = _underlyingToken == ETH_TOKEN_ADDRESS ? _underlyingUnits : 0;
        bytes memory callData = abi.encodeWithSignature("deposit(address,uint256)", _underlyingToken, _underlyingUnits);
        return (address(this), value, callData);
    }

    function getUnwrapCallData(
        address _underlyingToken,
        address /* _wrappedToken */,
        uint256 _wrappedTokenUnits
    ) external view returns (address _subject, uint256 _value, bytes memory _calldata) {
        bytes memory callData = abi.encodeWithSignature("withdraw(address,uint256)", _underlyingToken, _wrappedTokenUnits);
        return (address(this), 0, callData);
    }

    function getWrapSpenderAddress(address /* _underlyingToken */, address  _wrappedToken) external view returns(address) {
        return address(this);
    }

    function getUnwrapSpenderAddress(address /* _underlyingToken */, address  _wrappedToken) external view returns(address) {
        return address(this);
    }

    function getSpenderAddress(
        address /* _underlyingToken */,
        address /* _wrappedToken */
    ) external view returns(address) {
        return address(this);
    }

    function getDepositUnderlyingTokenAmount(
        address _underlyingToken,
        address /* _wrappedToken */,
        uint256 _wrappedTokenAmount
    ) external view returns(uint256) {
        uint256 unitDecimals;
        if (_underlyingToken == ETH_TOKEN_ADDRESS) {
            unitDecimals = 18;             
        } else {
            unitDecimals = ERC20(_underlyingToken).decimals();
        }
        return _wrappedTokenAmount / (10 ** (18 - unitDecimals));
    }

    function getWithdrawUnderlyingTokenAmount(
        address _underlyingToken,
        address /* _wrappedToken */,
        uint256 _wrappedTokenAmount
    ) external view returns(uint256) {
        uint256 unitDecimals;
        if (_underlyingToken == ETH_TOKEN_ADDRESS) {
            unitDecimals = 18;             
        } else {
            unitDecimals = ERC20(_underlyingToken).decimals();
        }
        return _wrappedTokenAmount / (10 ** (18 - unitDecimals));
    }
}