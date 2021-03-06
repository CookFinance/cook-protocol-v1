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


import { ICKToken } from "../interfaces/ICKToken.sol";
import { IStreamingFeeModule } from "../interfaces/IStreamingFeeModule.sol";
import { StreamingFeeModule } from "../protocol/modules/StreamingFeeModule.sol";


/**
 * @title StreamingFeeModuleViewer
 * @author Cook Finance
 *
 * StreamingFeeModuleViewer enables batch queries of StreamingFeeModule state.
 */
contract StreamingFeeModuleViewer {

    struct StreamingFeeInfo {
        address feeRecipient;
        uint256 streamingFeePercentage;
        uint256 unaccruedFees;
    }

    function batchFetchStreamingFeeInfo(
        IStreamingFeeModule _streamingFeeModule,
        ICKToken[] memory _ckTokens
    )
        external
        view
        returns (StreamingFeeInfo[] memory)
    {
        StreamingFeeInfo[] memory feeInfo = new StreamingFeeInfo[](_ckTokens.length);

        for (uint256 i = 0; i < _ckTokens.length; i++) {
            StreamingFeeModule.FeeState memory feeState = _streamingFeeModule.feeStates(_ckTokens[i]);
            uint256 unaccruedFees = _streamingFeeModule.getFee(_ckTokens[i]);

            feeInfo[i] = StreamingFeeInfo({
                feeRecipient: feeState.feeRecipient,
                streamingFeePercentage: feeState.streamingFeePercentage,
                unaccruedFees: unaccruedFees
            });
        }

        return feeInfo;
    }
}