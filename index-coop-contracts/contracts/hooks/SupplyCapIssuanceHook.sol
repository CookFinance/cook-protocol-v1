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
pragma experimental ABIEncoderV2;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";

import { IManagerIssuanceHook } from "../interfaces/IManagerIssuanceHook.sol";
import { ICKToken } from "../interfaces/ICKToken.sol";


/**
 * @title SupplyCapIssuanceHook
 * @author Cook Finance
 *
 * Issuance hook that checks new issuances won't push CKToken totalSupply over supply cap.
 */
contract SupplyCapIssuanceHook is Ownable, IManagerIssuanceHook {
    using SafeMath for uint256;

    /* ============ Events ============ */

    event SupplyCapUpdated(uint256 _newCap);
    
    /* ============ State Variables ============ */

    // Cap on totalSupply of CKs
    uint256 public supplyCap;

    /* ============ Constructor ============ */

    /**
     * Constructor, overwrites owner and original supply cap.
     *
     * @param _initialOwner     Owner address, overwrites Ownable logic which sets to deployer as default
     * @param _supplyCap        Supply cap for CK (in wei of CK)
     */
    constructor(
        address _initialOwner,
        uint256 _supplyCap
    )
        public
    {
        supplyCap = _supplyCap;

        // Overwrite _owner param of Ownable contract
        transferOwnership(_initialOwner);
    }

    /**
     * Adheres to IManagerIssuanceHook interface, and checks to make sure the current issue call won't push total supply over cap.
     */
    function invokePreIssueHook(
        ICKToken _ckToken,
        uint256 _issueQuantity,
        address /*_sender*/,
        address /*_to*/
    )
        external
        override
    {
        uint256 totalSupply = _ckToken.totalSupply();

        require(totalSupply.add(_issueQuantity) <= supplyCap, "Supply cap exceeded");
    }

    /**
     * Adheres to IManagerIssuanceHook interface
     */
    function invokePreRedeemHook(
        ICKToken _ckToken,
        uint256 _redeemQuantity,
        address _sender,
        address _to
    )
        external
        override
    {}

    /**
     * ONLY OWNER: Updates supply cap
     */
    function updateSupplyCap(uint256 _newCap) external onlyOwner {
        supplyCap = _newCap;
        SupplyCapUpdated(_newCap);
    }
}