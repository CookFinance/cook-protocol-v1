pragma solidity 0.6.10;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";


/**
 * @title IAlpacaBEP20
 *
 * Interface for interacting with Alpaca interest bearing tokens
 */
interface IAlpacaBEP20 is IERC20 {

    function withdraw(uint256 share) external;

    function deposit(uint256 amountToken) external;

    function totalToken() external view returns (uint256);

    function token() external view returns (address);
}