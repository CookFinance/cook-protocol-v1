pragma solidity 0.6.10;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IVenusToken is IERC20 {

    function mint(uint256 mintAmount) external returns (uint256);

    function redeem(uint256 redeemTokens) external returns (uint256);

    function redeemUnderlying(uint256 redeemAmount) external returns (uint256);

    function borrow(uint256 borrowAmount) external returns (uint256);

    function repayBorrow(uint256 repayAmount) external returns (uint256);

    function balanceOfUnderlying(address owner) external returns (uint256);

    function borrowBalanceStored(address account) external view returns (uint);

    function borrowBalanceCurrent(address account) external returns (uint256);
    
    function getAccountSnapshot(address account) external view returns (uint, uint, uint, uint);

    function accrueInterest() external returns (uint);

    function exchangeRateStored() external view returns (uint256);

    function isVToken() external view returns (bool);

    function underlying() external view returns (address); 
}

interface IVenusBNB is IVenusToken {
    function mint() external payable;

    function repayBorrow() external payable;
}

interface IVenusDistribution {
    function claimVenus(address holder) external;

    function enterMarkets(address[] memory _vtokens) external;

    function exitMarket(address _vtoken) external;

    function getAssetsIn(address account)
        external
        view
        returns (address[] memory);

    function getAccountLiquidity(address account)
        external
        view
        returns (
            uint256,
            uint256,
            uint256
        );
}