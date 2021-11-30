pragma solidity 0.6.10;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";


/**
 * @title IVToken
 *
 * Interface for interacting with Vesper pool tokens
 */
interface IVToken is IERC20 {

    function convertTo18(uint256 amount) external view returns (uint256);

    function convertFrom18(uint256 amount) external view returns (uint256);

    function totalValue() external view returns (uint256);

    function withdrawFee() external view virtual returns (uint256);

    function token() external view returns (address);

    function getPricePerShare() external view returns (uint256);
}