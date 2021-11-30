pragma solidity 0.6.10;

/**
 * @title Curve
 *
 * Interface for Curve pool
 */
interface ICurve {
    function get_virtual_price() external view returns (uint256);
}