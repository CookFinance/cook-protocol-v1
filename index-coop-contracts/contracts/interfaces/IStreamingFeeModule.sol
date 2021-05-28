pragma solidity 0.6.10;
pragma experimental "ABIEncoderV2";

import { ICKToken } from "./ICKToken.sol";

interface IStreamingFeeModule {
    function getFee(ICKToken _ckToken) external view returns (uint256);
    function accrueFee(ICKToken _ckToken) external;
    function updateStreamingFee(ICKToken _ckToken, uint256 _newFee) external;
    function updateFeeRecipient(ICKToken _ckToken, address _newFeeRecipient) external;
}