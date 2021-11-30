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

import { ICKValuer } from "../../interfaces/ICKValuer.sol";
import { ICKToken } from "../../interfaces/ICKToken.sol";

/**
 * @title CustomCKValuerMock
 * @author Cook Finance
 *
 * Contract that returns a mocked valuation for a ck.
 */
contract CustomCKValuerMock is ICKValuer {
    /* ============ State Variables ============ */

    mapping (address => uint256) valuation;

    /* ============ External Functions ============ */
    function setValuation(address _quoteAsset, uint256 _valuation) external {
        valuation[_quoteAsset] = _valuation;
    }

    /**
     * Gets the valuation of a CKToken using data from the price oracle. Reverts
     * if no price exists for a component in the CKToken. Note: this works for external
     * positions and negative (debt) positions.
     *
     * Note: There is a risk that the valuation is off if airdrops aren't retrieved or
     * debt builds up via interest and its not reflected in the position
     *
     * @param _quoteAsset      Address of token to quote valuation in
     *
     * @return                 CKToken valuation in terms of quote asset in precise units 1e18
     */
    function calculateCKTokenValuation(ICKToken /* _ckToken */, address _quoteAsset) external view override returns (uint256) {
        return valuation[_quoteAsset];
    }
}
