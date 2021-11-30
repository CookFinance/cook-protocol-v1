// SPDX-License-Identifier: MIT
pragma solidity >= 0.6.10 <=0.7.0;

import { IYieldYakStrategyV2 } from "../../interfaces/external/IYieldYakStrategyV2.sol";
import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { YakStrategyV2 } from "../../../external/contracts/yieldyak/YakStrategyV2.sol";

/**
 * @title Strategy for Banker Joe ERC20
 * @dev Bank Joe emits rewards in AVAX and ERC20. During AVAX claim, contract becomes gas bound
 */
contract YieldYakStrategy2Mock is YakStrategyV2 {
    using SafeMath for uint256;

    constructor (address _depositToken) public {
        depositToken = IERC20(_depositToken);
    }

    function totalDeposits() public view override returns (uint256) {
        return depositToken.balanceOf(address(this));
    }

    function deposit(uint256 amount) external override {
        _deposit(msg.sender, amount);
    }

    function depositFor(address account, uint256 amount) external override {
        _deposit(account, amount);
    }

    function depositWithPermit(
        uint256 amount,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external override {
        _deposit(msg.sender, amount);
    }

    function reinvest() external override onlyEOA {
        // just a mock
    }    

    function checkReward() public view override returns (uint256) {
        return 0; // just a mock
    }

    function estimateDeployedBalance() external view override returns (uint256) {
        return 0; // just a mock
    }    

    function rescueDeployedFunds(uint256 minReturnAmountAccepted, bool disableDeposits) external override onlyOwner {
        // just a mock
    }

    function setAllowances() public override onlyOwner {
        // just a mock
    }

    function withdraw(uint amount) external override {
        _burn(msg.sender, amount);
        uint256 toReturn = amount.mul(110).div(100);
        depositToken.transfer(msg.sender, toReturn);
    }

    function _deposit(address account, uint256 amount) private {
        depositToken.transferFrom(msg.sender, address(this), amount);
        uint256 toMint = amount.mul(100).div(115);
        _mint(account, toMint);
    }
}
