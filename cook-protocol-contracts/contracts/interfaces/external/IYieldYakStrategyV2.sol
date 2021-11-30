// SPDX-License-Identifier: MIT
pragma solidity 0.6.10;


/**
 * @title Yield Yak Strategy2 Interface
 */
interface IYieldYakStrategyV2 {

    // function depositToken() external view returns (IERC20);
    // function rewardToken() external view returns (address);
    // function devAddr() external view returns (address);

    // function MIN_TOKENS_TO_REINVEST() external view returns (uint);
    // function MAX_TOKENS_TO_DEPOSIT_WITHOUT_REINVEST() external view returns (uint);
    // function DEPOSITS_ENABLED() external view returns (bool);

    // function REINVEST_REWARD_BIPS() external view returns (uint);
    // function ADMIN_FEE_BIPS() external view returns (uint);
    // function DEV_FEE_BIPS() external view returns (uint);

    // function BIPS_DIVISOR() external view returns (uint);
    // function MAX_UINT() external view returns (uint);

    function deposit(uint amount) external;
    function withdraw(uint amount) external; 
    function getSharesForDepositTokens(uint amount) external view returns (uint);
    function getDepositTokensForShares(uint amount) external view returns (uint);
}