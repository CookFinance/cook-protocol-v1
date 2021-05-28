pragma solidity 0.6.10;
pragma experimental "ABIEncoderV2";

import { ICKToken } from "./ICKToken.sol";

interface ICompoundLeverageModule {
    function sync(
        ICKToken _ckToken
    ) external;

    function lever(
        ICKToken _ckToken,
        address _borrowAsset,
        address _collateralAsset,
        uint256 _borrowQuantity,
        uint256 _minReceiveQuantity,
        string memory _tradeAdapterName,
        bytes memory _tradeData
    ) external;

    function delever(
        ICKToken _ckToken,
        address _collateralAsset,
        address _repayAsset,
        uint256 _redeemQuantity,
        uint256 _minRepayQuantity,
        string memory _tradeAdapterName,
        bytes memory _tradeData
    ) external;

    function gulp(
        ICKToken _ckToken,
        address _collateralAsset,
        uint256 _minNotionalReceiveQuantity,
        string memory _tradeAdapterName,
        bytes memory _tradeData
    ) external;
}