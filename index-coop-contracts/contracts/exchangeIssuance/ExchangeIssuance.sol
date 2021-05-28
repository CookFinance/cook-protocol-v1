/*
    Copyright 2021 Index Cooperative
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
pragma experimental ABIEncoderV2;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IUniswapV2Factory } from "@uniswap/v2-core/contracts/interfaces/IUniswapV2Factory.sol";
import { IUniswapV2Router02 } from "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";
import { Math } from "@openzeppelin/contracts/math/Math.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import { IBasicIssuanceModule } from "../interfaces/IBasicIssuanceModule.sol";
import { IController } from "../interfaces/IController.sol";
import { ICKToken } from "../interfaces/ICKToken.sol";
import { IWETH } from "../interfaces/IWETH.sol";
import { PreciseUnitMath } from "../lib/PreciseUnitMath.sol";
import { SushiswapV2Library } from "../../external/contracts/SushiswapV2Library.sol";
import { UniswapV2Library } from "../../external/contracts/UniswapV2Library.sol";

/**
 * @title ExchangeIssuance
 * @author Index Coop
 *
 * Contract for issuing and redeeming any CKToken using ETH or an ERC20 as the paying/receiving currency.
 * All swaps are done using the best price found on Uniswap or Sushiswap.
 *
 */
contract ExchangeIssuance is ReentrancyGuard {
    
    using SafeMath for uint256;
    using PreciseUnitMath for uint256;
    using SafeERC20 for IERC20;
    using SafeERC20 for ICKToken;
    
    /* ============ Enums ============ */
    
    enum Exchange { Uniswap, Sushiswap }

    /* ============ Constants ============= */

    address constant private ETH_ADDRESS = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;
    
    /* ============ State Variables ============ */

    IUniswapV2Router02 private uniRouter;
    address private uniFactory;
    IUniswapV2Router02 private sushiRouter;
    address private sushiFactory;
    
    IController private ckController;
    IBasicIssuanceModule private basicIssuanceModule;
    address private WETH;

    /* ============ Events ============ */

    event ExchangeIssue(
        address indexed _recipient,     // The recipient address of the issued CKTokens
        ICKToken indexed _ckToken,    // The issued CKToken
        IERC20 indexed _inputToken,    // The address of the input asset(ERC20/ETH) used to issue the CKTokens
        uint256 _amountInputToken,      // The amount of input tokens used for issuance
        uint256 _amountSetIssued        // The amount of CKTokens received by the recipient
    );

    event ExchangeRedeem(
        address indexed _recipient,     // The recipient address which redeemed the CKTokens
        ICKToken indexed _ckToken,    // The redeemed CKToken
        IERC20 indexed _outputToken,   // The addres of output asset(ERC20/ETH) received by the recipient
        uint256 _amountSetRedeemed,     // The amount of CKTokens redeemed for output tokens
        uint256 _amountOutputToken      // The amount of output tokens received by the recipient
    );
    
    /* ============ Modifiers ============ */
    
    modifier isCKToken(ICKToken _ckToken) {
         require(ckController.isCK(address(_ckToken)), "ExchangeIssuance: INVALID SET");
         _;
    }
    
    /* ============ Constructor ============ */

    constructor(
        address _uniFactory,
        IUniswapV2Router02 _uniRouter, 
        address _sushiFactory, 
        IUniswapV2Router02 _sushiRouter, 
        IController _ckController,
        IBasicIssuanceModule _basicIssuanceModule
    )
        public
    {
        uniFactory = _uniFactory;
        uniRouter = _uniRouter;

        sushiFactory = _sushiFactory;
        sushiRouter = _sushiRouter;

        WETH = uniRouter.WETH();
        ckController = _ckController;
        basicIssuanceModule = _basicIssuanceModule;
        IERC20(WETH).safeApprove(address(uniRouter), PreciseUnitMath.maxUint256());
        IERC20(WETH).safeApprove(address(sushiRouter), PreciseUnitMath.maxUint256());
    }
    
    /* ============ Public Functions ============ */
    
    /**
     * Runs all the necessary approval functions required for a given ERC20 token.
     * This function can be called when a new token is added to a CKToken during a 
     * rebalance.
     *
     * @param _token    Address of the token which needs approval
     */
    function approveToken(IERC20 _token) public {
        _safeApprove(_token, address(uniRouter));
        _safeApprove(_token, address(sushiRouter));
        _safeApprove(_token, address(basicIssuanceModule));
    }

    /* ============ External Functions ============ */
    
    /**
     * Runs all the necessary approval functions required for a list of ERC20 tokens.
     *
     * @param _tokens    Addresses of the tokens which need approval
     */
    function approveTokens(IERC20[] calldata _tokens) external {
        for (uint256 i = 0; i < _tokens.length; i++) {
            approveToken(_tokens[i]);
        }
    }

    /**
     * Runs all the necessary approval functions required before issuing
     * or redeeming a CKToken. This function need to be called only once before the first time
     * this smart contract is used on any particular CKToken.
     *
     * @param _ckToken    Address of the CKToken being initialized
     */
    function approveCKToken(ICKToken _ckToken) external {
        address[] memory components = _ckToken.getComponents();
        for (uint256 i = 0; i < components.length; i++) {
            approveToken(IERC20(components[i]));
        }
    }

    /**
     * Issues CKTokens for an exact amount of input ERC20 tokens.
     * The ERC20 token must be approved by the sender to this contract. 
     *
     * @param _ckToken         Address of the CKToken being issued
     * @param _inputToken       Address of input token
     * @param _amountInput      Amount of the input token / ether to spend
     * @param _minSetReceive    Minimum amount of CKTokens to receive. Prevents unnecessary slippage.
     */
    function issueSetForExactToken(
        ICKToken _ckToken,
        IERC20 _inputToken,
        uint256 _amountInput,
        uint256 _minSetReceive
    )   
        isCKToken(_ckToken)
        external
        nonReentrant
    {   
        require(_amountInput > 0, "ExchangeIssuance: INVALID INPUTS");
        
        _inputToken.safeTransferFrom(msg.sender, address(this), _amountInput);
        
        if (address(_inputToken) != WETH) {
           _swapTokenForWETH(_inputToken, _amountInput);
        }

        uint256 ckTokenAmount = _issueSetForExactWETH(_ckToken, _minSetReceive);
        
        emit ExchangeIssue(msg.sender, _ckToken, _inputToken, _amountInput, ckTokenAmount);
    }
    
    /**
     * Issues CKTokens for an exact amount of input ether.
     * 
     * @param _ckToken         Address of the CKToken to be issued
     * @param _minSetReceive    Minimum amount of CKTokens to receive. Prevents unnecessary slippage.
     */
    function issueSetForExactETH(
        ICKToken _ckToken,
        uint256 _minSetReceive
    )
        isCKToken(_ckToken)
        external
        payable
        nonReentrant
    {
        require(msg.value > 0, "ExchangeIssuance: INVALID INPUTS");
        
        IWETH(WETH).deposit{value: msg.value}();
        
        uint256 ckTokenAmount = _issueSetForExactWETH(_ckToken, _minSetReceive);
        
        emit ExchangeIssue(msg.sender, _ckToken, IERC20(ETH_ADDRESS), msg.value, ckTokenAmount);
    }
    
    /**
    * Issues an exact amount of CKTokens for given amount of input ERC20 tokens.
    * The excess amount of tokens is returned in an equivalent amount of ether.
    *
    * @param _ckToken              Address of the CKToken to be issued
    * @param _inputToken            Address of the input token
    * @param _amountCKToken        Amount of CKTokens to issue
    * @param _maxAmountInputToken   Maximum amount of input tokens to be used to issue CKTokens
    */
    function issueExactSetFromToken(
        ICKToken _ckToken,
        IERC20 _inputToken,
        uint256 _amountCKToken,
        uint256 _maxAmountInputToken
    )
        isCKToken(_ckToken)
        external
        nonReentrant
    {
        require(_amountCKToken > 0 && _maxAmountInputToken > 0, "ExchangeIssuance: INVALID INPUTS");
        
        _inputToken.safeTransferFrom(msg.sender, address(this), _maxAmountInputToken);
        
        uint256 initETHAmount = address(_inputToken) == WETH
            ? _maxAmountInputToken
            :  _swapTokenForWETH(_inputToken, _maxAmountInputToken);
        
        uint256 amountEthSpent = _issueExactSetFromWETH(_ckToken, _amountCKToken);
        
        uint256 amountEthReturn = initETHAmount.sub(amountEthSpent);
        if (amountEthReturn > 0) {
            IWETH(WETH).withdraw(amountEthReturn);
            msg.sender.transfer(amountEthReturn);
        }
        
        emit ExchangeIssue(msg.sender, _ckToken, _inputToken, _maxAmountInputToken, _amountCKToken);
    }
    
    /**
    * Issues an exact amount of CKTokens using a given amount of ether.
    * The excess ether is returned back.
    * 
    * @param _ckToken          Address of the CKToken being issued
    * @param _amountCKToken    Amount of CKTokens to issue
    */
    function issueExactSetFromETH(
        ICKToken _ckToken,
        uint256 _amountCKToken
    )
        isCKToken(_ckToken)
        external
        payable
        nonReentrant
    {
        require(msg.value > 0 && _amountCKToken > 0, "ExchangeIssuance: INVALID INPUTS");
        
        IWETH(WETH).deposit{value: msg.value}();
        
        uint256 amountEth = _issueExactSetFromWETH(_ckToken, _amountCKToken);
        
        uint256 returnAmount = msg.value.sub(amountEth);
        
        if (returnAmount > 0) {
            IWETH(WETH).withdraw(returnAmount);
            msg.sender.transfer(returnAmount);    
        }
        
        emit ExchangeIssue(msg.sender, _ckToken, IERC20(ETH_ADDRESS), amountEth, _amountCKToken);
    }
    
    /**
     * Redeems an exact amount of CKTokens for an ERC20 token.
     * The CKToken must be approved by the sender to this contract.
     *
     * @param _ckToken             Address of the CKToken being redeemed
     * @param _outputToken          Address of output token
     * @param _amountSetToRedeem    Amount CKTokens to redeem
     * @param _minOutputReceive     Minimum amount of output token to receive
     */
    function redeemExactSetForToken(
        ICKToken _ckToken,
        IERC20 _outputToken,
        uint256 _amountSetToRedeem,
        uint256 _minOutputReceive
    )
        isCKToken(_ckToken)
        external
        nonReentrant
    {
        require(_amountSetToRedeem > 0, "ExchangeIssuance: INVALID INPUTS");
        
        uint256 amountEthOut = _redeemExactSetForWETH(_ckToken, _amountSetToRedeem);
        
        if (address(_outputToken) == WETH) {
            require(amountEthOut > _minOutputReceive, "ExchangeIssuance: INSUFFICIENT_OUTPUT_AMOUNT");
            _outputToken.safeTransfer(msg.sender, amountEthOut);
            
            emit ExchangeRedeem(msg.sender, _ckToken, _outputToken, _amountSetToRedeem, amountEthOut);
        } else {
            // Get max amount of tokens with the available amountEthOut
            (uint256 amountTokenOut, Exchange exchange) = _getMaxTokenForExactToken(amountEthOut, address(WETH), address(_outputToken));
            require(amountTokenOut > _minOutputReceive, "ExchangeIssuance: INSUFFICIENT_OUTPUT_AMOUNT");
            
            uint256 outputAmount = _swapExactTokensForTokens(exchange, WETH, address(_outputToken), amountEthOut);
            _outputToken.safeTransfer(msg.sender, outputAmount);
           
            emit ExchangeRedeem(msg.sender, _ckToken, _outputToken, _amountSetToRedeem, outputAmount);
        }
    }
    
    /**
     * Redeems an exact amount of CKTokens for ETH.
     * The CKToken must be approved by the sender to this contract.
     *
     * @param _ckToken             Address of the CKToken being redeemed
     * @param _amountSetToRedeem    Amount CKTokens to redeem
     * @param _minETHReceive        Minimum amount of ETH to receive
     */
    function redeemExactSetForETH(
        ICKToken _ckToken,
        uint256 _amountSetToRedeem,
        uint256 _minETHReceive
    )
        isCKToken(_ckToken)
        external
        nonReentrant
    {
        require(_amountSetToRedeem > 0, "ExchangeIssuance: INVALID INPUTS");
        
        uint256 amountEthOut = _redeemExactSetForWETH(_ckToken, _amountSetToRedeem);
        
        require(amountEthOut > _minETHReceive, "ExchangeIssuance: INSUFFICIENT_OUTPUT_AMOUNT");
        
        IWETH(WETH).withdraw(amountEthOut);
        msg.sender.transfer(amountEthOut);

        emit ExchangeRedeem(msg.sender, _ckToken, IERC20(ETH_ADDRESS), _amountSetToRedeem, amountEthOut);
    }

    // required for weth.withdraw() to work properly
    receive() external payable {}

    /**
     * Returns an estimated quantity of the specified CKToken given a specified amount of input token.
     * Estimating pulls the best price of each component using Uniswap or Sushiswap
     *
     * @param _ckToken         Address of the CKToken being issued
     * @param _amountInput      Amount of the input token to spend
     * @param _inputToken       Address of input token.
     * @return                  Estimated amount of CKTokens that will be received
     */
    function getEstimatedIssueSetAmount(
        ICKToken _ckToken,
        IERC20 _inputToken,
        uint256 _amountInput
    )
        isCKToken(_ckToken)
        external
        view
        returns (uint256)
    {
        require(_amountInput > 0, "ExchangeIssuance: INVALID INPUTS");
        
        uint256 amountEth;
        if (address(_inputToken) != WETH) {
            (amountEth, ) = _getMaxTokenForExactToken(_amountInput, address(WETH),  address(_inputToken));
        } else {
            amountEth = _amountInput;
        }
        
        (uint256[] memory amountEthIn, Exchange[] memory exchanges, uint256 sumEth) = _getAmountETHForIssuance(_ckToken);
        
        uint256 maxIndexAmount = PreciseUnitMath.maxUint256();
        address[] memory components = _ckToken.getComponents();
        
        for (uint256 i = 0; i < components.length; i++) {
            address component = components[i];
            uint256 scaledAmountEth = amountEthIn[i].mul(amountEth).div(sumEth);
            
            uint256 amountTokenOut;
            if (exchanges[i] == Exchange.Uniswap) {
                (uint256 tokenReserveA, uint256 tokenReserveB) = UniswapV2Library.getReserves(uniFactory, WETH, component);
                amountTokenOut = UniswapV2Library.getAmountOut(scaledAmountEth, tokenReserveA, tokenReserveB);
            } else {
                require(exchanges[i] == Exchange.Sushiswap);
                (uint256 tokenReserveA, uint256 tokenReserveB) = SushiswapV2Library.getReserves(sushiFactory, WETH, component);
                amountTokenOut = SushiswapV2Library.getAmountOut(scaledAmountEth, tokenReserveA, tokenReserveB);
            }

            uint256 unit = uint256(_ckToken.getDefaultPositionRealUnit(component));
            maxIndexAmount = Math.min(amountTokenOut.preciseDiv(unit), maxIndexAmount);
        }
        return maxIndexAmount;
    }
    
    /**
    * Returns the amount of input tokens required to issue an exact amount of CKTokens.
    *
    * @param _ckToken          Address of the CKToken being issued
    * @param _amountCKToken    Amount of CKTokens to issue
    * @return                   Amount of tokens needed to issue specified amount of CKTokens
    */
    function getAmountInToIssueExactSet(
        ICKToken _ckToken,
        IERC20 _inputToken,
        uint256 _amountCKToken
    )
        isCKToken(_ckToken)
        external
        view
        returns(uint256)
    {
        require(_amountCKToken > 0, "ExchangeIssuance: INVALID INPUTS");
        
        uint256 totalEth = 0;
        
        address[] memory components = _ckToken.getComponents();
        for (uint256 i = 0; i < components.length; i++) {
            uint256 unit = uint256(_ckToken.getDefaultPositionRealUnit(components[i]));
            uint256 amountToken = unit.preciseMul(_amountCKToken);
            
            // get minimum amount of ETH to be spent to acquire the required amount of tokens
            (uint256 amountEth,) = _getMinTokenForExactToken(amountToken, WETH, components[i]);
            totalEth = totalEth.add(amountEth);
        }
        
        if (address(_inputToken) == WETH) {
            return totalEth;
        }
        
        (uint256 tokenAmount, ) = _getMinTokenForExactToken(totalEth, address(_inputToken), address(WETH));
        return tokenAmount;
    }
    
    /**
     * Returns an estimated amount of ETH or specified ERC20 received for a given CKToken and CKToken amount. 
     *
     * @param _ckToken             CKToken redeemed
     * @param _amountSetToRedeem    Amount of CKToken
     * @param _outputToken          Address of output token. Ignored if _isOutputETH is true
     * @return                      Estimated amount of ether/erc20 that will be received
     */
    function getEstimatedRedeemSetAmount(
        ICKToken _ckToken,
        address _outputToken,
        uint256 _amountSetToRedeem
    ) 
        isCKToken(_ckToken)
        external
        view
        returns (uint256)
    {
        require(_amountSetToRedeem > 0, "ExchangeIssuance: INVALID INPUTS");
        
        address[] memory components = _ckToken.getComponents();
        uint256 totalEth = 0;
        for (uint256 i = 0; i < components.length; i++) {
            uint256 unit = uint256(_ckToken.getDefaultPositionRealUnit(components[i]));
            uint256 amount = unit.preciseMul(_amountSetToRedeem);
            
            // get maximum amount of ETH received for a given amount of CKToken component
            (uint256 amountEth, ) = _getMaxTokenForExactToken(amount, components[i], WETH);
            totalEth = totalEth.add(amountEth);
        }
        if (_outputToken == WETH) {
            return totalEth;
        }
        
        // get maximum amount of tokens for totalEth amount of ETH
        (uint256 tokenAmount, ) = _getMaxTokenForExactToken(totalEth, WETH, _outputToken);
        return tokenAmount;
    }
    
    
    /* ============ Internal Functions ============ */

    /**
     * Sets a max aproval limit for an ERC20 token, provided the current allowance is zero. 
     * 
     * @param _token    Token to approve
     * @param _spender  Spender address to approve
     */
    function _safeApprove(IERC20 _token, address _spender) internal {
        if (_token.allowance(address(this), _spender) == 0) {
            _token.safeIncreaseAllowance(_spender, PreciseUnitMath.maxUint256());
        }
    }
    
    /**
     * Sells the total balance that the contract holds of each component of the set
     * using the best quoted price from either Uniswap or Sushiswap
     * 
     * @param _ckToken     The CKToken that is being liquidated
     * @return              Amount of WETH received after liquidating all components of the CKToken
     */
    function _liquidateComponentsForWETH(ICKToken _ckToken) internal returns (uint256) {
        uint256 sumEth = 0;
        address[] memory components = _ckToken.getComponents();
        for (uint256 i = 0; i < components.length; i++) {
            
            // Check that the component does not have external positions
            require(
                _ckToken.getExternalPositionModules(components[i]).length == 0,
                "Exchange Issuance: EXTERNAL_POSITIONS_NOT_ALLOWED"
            );

            address token = components[i];
            uint256 tokenBalance = IERC20(token).balanceOf(address(this));
            
            // Get max amount of WETH for the available amount of CKToken component
            (, Exchange exchange) = _getMaxTokenForExactToken(tokenBalance, token, WETH);
            sumEth = sumEth.add(_swapExactTokensForTokens(exchange, token, WETH, tokenBalance));
        }
        return sumEth;
    }
    
    /**
     * Issues CKTokens for an exact amount of input WETH. 
     * Acquires CKToken components at the best price accross uniswap and sushiswap.
     * Uses the acquired components to issue the CKTokens.
     * 
     * @param _ckToken         Address of the CKToken being issued
     * @param _minSetReceive    Minimum amount of index to receive
     * @return ckTokenAmount   Amount of CKTokens issued
     */
    function _issueSetForExactWETH(ICKToken _ckToken, uint256 _minSetReceive) internal returns (uint256) {
        uint256 wethBalance = IERC20(WETH).balanceOf(address(this));
        
        (uint256[] memory amountEthIn, Exchange[] memory exchanges, uint256 sumEth) = _getAmountETHForIssuance(_ckToken);

        uint256 ckTokenAmount = _acquireComponents(_ckToken, amountEthIn, exchanges, wethBalance, sumEth);
        
        require(ckTokenAmount > _minSetReceive, "ExchangeIssuance: INSUFFICIENT_OUTPUT_AMOUNT");
        
        basicIssuanceModule.issue(_ckToken, ckTokenAmount, msg.sender);
        
        return ckTokenAmount;
    }
    
    /**
     * Issues an exact amount of CKTokens using WETH. 
     * Acquires CKToken components at the best price accross uniswap and sushiswap.
     * Uses the acquired components to issue the CKTokens.
     * 
     * @param _ckToken          Address of the CKToken being issued
     * @param _amountCKToken    Amount of CKTokens to issue
     * @return sumEth            Total amount of ether used to acquire the CKToken components    
     */
    function _issueExactSetFromWETH(ICKToken _ckToken, uint256 _amountCKToken) internal returns (uint256) {
        
        uint256 sumEth = 0;
        
        address[] memory components = _ckToken.getComponents();
        for (uint256 i = 0; i < components.length; i++) {
            
            // Check that the component does not have external positions
            require(
                _ckToken.getExternalPositionModules(components[i]).length == 0,
                "Exchange Issuance: EXTERNAL_POSITIONS_NOT_ALLOWED"
            );

            uint256 unit = uint256(_ckToken.getDefaultPositionRealUnit(components[i]));
            uint256 amountToken = uint256(unit).preciseMul(_amountCKToken);
            
            // Get minimum amount of ETH to be spent to acquire the required amount of CKToken component
            (, Exchange exchange) = _getMinTokenForExactToken(amountToken, WETH, components[i]);
            uint256 amountEth = _swapTokensForExactTokens(exchange, WETH, components[i], amountToken);
            sumEth = sumEth.add(amountEth);
        }
        basicIssuanceModule.issue(_ckToken, _amountCKToken, msg.sender);
        return sumEth;
    }
    
    /**
     * Redeems a given amount of CKToken and then liquidates the components received for WETH.
     * 
     * @param _ckToken             Address of the CKToken to be redeemed
     * @param _amountSetToRedeem    Amount of CKToken to be redeemed
     * @return                      Amount of WETH received after liquidating CKToken components
     */
    function _redeemExactSetForWETH(ICKToken _ckToken, uint256 _amountSetToRedeem) internal returns (uint256) {
        _ckToken.safeTransferFrom(msg.sender, address(this), _amountSetToRedeem);
        
        basicIssuanceModule.redeem(_ckToken, _amountSetToRedeem, address(this));
        
        return _liquidateComponentsForWETH(_ckToken);
    }
    
    /**
     * Gets the amount of ether required for issuing each component in a set CKToken.
     * The amount of ether is calculated based on prices across both uniswap and sushiswap.
     * 
     * @param _ckToken      Address of the CKToken
     * @return amountEthIn   An array containing the amount of ether to purchase each component of the set
     * @return exchanges     An array containing the exchange on which to perform the swap
     * @return sumEth        The approximate total ETH cost to issue the set
     */
    function _getAmountETHForIssuance(ICKToken _ckToken)
        internal
        view
        returns (uint256[] memory, Exchange[] memory, uint256)
    {
        uint256 sumEth = 0;
        address[] memory components = _ckToken.getComponents();
        
        uint256[] memory amountEthIn = new uint256[](components.length);
        Exchange[] memory exchanges = new Exchange[](components.length);
        
        for (uint256 i = 0; i < components.length; i++) {

            // Check that the component does not have external positions
            require(
                _ckToken.getExternalPositionModules(components[i]).length == 0,
                "Exchange Issuance: EXTERNAL_POSITIONS_NOT_ALLOWED"
            );

            // Get minimum amount of ETH to be spent to acquire the required amount of CKToken component
            uint256 unit = uint256(_ckToken.getDefaultPositionRealUnit(components[i]));
            (amountEthIn[i], exchanges[i]) = _getMinTokenForExactToken(unit, WETH, components[i]);
            sumEth = sumEth.add(amountEthIn[i]);
        }
        return (amountEthIn, exchanges, sumEth);
    }
    
    /**
     * Aquires all the components neccesary to issue a set, purchasing tokens
     * from either Uniswap or Sushiswap to get the best price.
     *
     * @param _ckToken      The set token
     * @param _amountEthIn   An array containing the approximate ETH cost of each component.
     * @param _wethBalance   The amount of WETH that the contract has to spend on aquiring the total components
     * @param _sumEth        The approximate amount of ETH required to purchase the necessary tokens
     *
     * @return               The maximum amount of the CKToken that can be issued with the aquired components
     */
    function _acquireComponents(
        ICKToken _ckToken,
        uint256[] memory _amountEthIn,
        Exchange[] memory _exchanges,
        uint256 _wethBalance,
        uint256 _sumEth
    ) 
        internal
        returns (uint256)
    {
        address[] memory components = _ckToken.getComponents();
        uint256 maxIndexAmount = PreciseUnitMath.maxUint256();

        for (uint256 i = 0; i < components.length; i++) {

            uint256 scaledAmountEth = _amountEthIn[i].mul(_wethBalance).div(_sumEth);
            
            uint256 amountTokenOut = _swapExactTokensForTokens(_exchanges[i], WETH, components[i], scaledAmountEth);

            uint256 unit = uint256(_ckToken.getDefaultPositionRealUnit(components[i]));
            maxIndexAmount = Math.min(amountTokenOut.preciseDiv(unit), maxIndexAmount);
        }
        return maxIndexAmount;
    }
    
    /**
     * Swaps a given amount of an ERC20 token for WETH for the best price on Uniswap/Sushiswap.
     * 
     * @param _token    Address of the ERC20 token to be swapped for WETH
     * @param _amount   Amount of ERC20 token to be swapped
     * @return          Amount of WETH received after the swap
     */
    function _swapTokenForWETH(IERC20 _token, uint256 _amount) internal returns (uint256) {
        (, Exchange exchange) = _getMaxTokenForExactToken(_amount, address(_token), WETH);
        IUniswapV2Router02 router = _getRouter(exchange);
        _safeApprove(_token, address(router));
        return _swapExactTokensForTokens(exchange, address(_token), WETH, _amount);
    }
    
    /**
     * Swap exact tokens for another token on a given DEX.
     *
     * @param _exchange     The exchange on which to peform the swap
     * @param _tokenIn      The address of the input token
     * @param _tokenOut     The address of the output token
     * @param _amountIn     The amount of input token to be spent
     * @return              The amount of output tokens
     */
    function _swapExactTokensForTokens(Exchange _exchange, address _tokenIn, address _tokenOut, uint256 _amountIn) internal returns (uint256) {
        address[] memory path = new address[](2);
        path[0] = _tokenIn;
        path[1] = _tokenOut;
        return _getRouter(_exchange).swapExactTokensForTokens(_amountIn, 0, path, address(this), block.timestamp)[1];
    }
    
    /**
     * Swap tokens for exact amount of output tokens on a given DEX.
     *
     * @param _exchange     The exchange on which to peform the swap
     * @param _tokenIn      The address of the input token
     * @param _tokenOut     The address of the output token
     * @param _amountOut    The amount of output token required
     * @return              The amount of input tokens spent
     */
    function _swapTokensForExactTokens(Exchange _exchange, address _tokenIn, address _tokenOut, uint256 _amountOut) internal returns (uint256) {
        address[] memory path = new address[](2);
        path[0] = _tokenIn;
        path[1] = _tokenOut;
        return _getRouter(_exchange).swapTokensForExactTokens(_amountOut, PreciseUnitMath.maxUint256(), path, address(this), block.timestamp)[0];
    }
 
    /**
     * Compares the amount of token required for an exact amount of another token across both exchanges,
     * and returns the min amount.
     *
     * @param _amountOut    The amount of output token
     * @param _tokenA       The address of tokenA
     * @param _tokenB       The address of tokenB
     * @return              The min amount of tokenA required across both exchanges
     * @return              The Exchange on which minimum amount of tokenA is required
     */
    function _getMinTokenForExactToken(uint256 _amountOut, address _tokenA, address _tokenB) internal view returns (uint256, Exchange) {
        
        uint256 uniEthIn = PreciseUnitMath.maxUint256();
        uint256 sushiEthIn = PreciseUnitMath.maxUint256();
        
        if (_pairAvailable(uniFactory, _tokenA, _tokenB)) {
            (uint256 tokenReserveA, uint256 tokenReserveB) = UniswapV2Library.getReserves(uniFactory, _tokenA, _tokenB);
            uniEthIn = UniswapV2Library.getAmountIn(_amountOut, tokenReserveA, tokenReserveB);
        }
        
        if (_pairAvailable(sushiFactory, _tokenA, _tokenB)) {
            (uint256 tokenReserveA, uint256 tokenReserveB) = SushiswapV2Library.getReserves(sushiFactory, _tokenA, _tokenB);
            sushiEthIn = SushiswapV2Library.getAmountIn(_amountOut, tokenReserveA, tokenReserveB);
        }
        
        return (uniEthIn <= sushiEthIn) ? (uniEthIn, Exchange.Uniswap) : (sushiEthIn, Exchange.Sushiswap);
    }
    
    /**
     * Compares the amount of token received for an exact amount of another token across both exchanges,
     * and returns the max amount.
     *
     * @param _amountIn     The amount of input token
     * @param _tokenA       The address of tokenA
     * @param _tokenB       The address of tokenB
     * @return              The max amount of tokens that can be received across both exchanges
     * @return              The Exchange on which maximum amount of token can be received
     */
    function _getMaxTokenForExactToken(uint256 _amountIn, address _tokenA, address _tokenB) internal view returns (uint256, Exchange) {
        
        uint256 uniTokenOut = 0;
        uint256 sushiTokenOut = 0;
        
        if(_pairAvailable(uniFactory, _tokenA, _tokenB)) {
            (uint256 tokenReserveA, uint256 tokenReserveB) = UniswapV2Library.getReserves(uniFactory, _tokenA, _tokenB);
            uniTokenOut = UniswapV2Library.getAmountOut(_amountIn, tokenReserveA, tokenReserveB);
        }
        
        if(_pairAvailable(sushiFactory, _tokenA, _tokenB)) {
            (uint256 tokenReserveA, uint256 tokenReserveB) = SushiswapV2Library.getReserves(sushiFactory, _tokenA, _tokenB);
            sushiTokenOut = SushiswapV2Library.getAmountOut(_amountIn, tokenReserveA, tokenReserveB);
        }
        
        return (uniTokenOut >= sushiTokenOut) ? (uniTokenOut, Exchange.Uniswap) : (sushiTokenOut, Exchange.Sushiswap); 
    }
    
    /**
     * Checks if a pair is available on the given DEX.
     *
     * @param _factory   The factory to use (can be either uniFactory or sushiFactory)
     * @param _tokenA    The address of the tokenA
     * @param _tokenB    The address of the tokenB
     * @return          A boolean representing if the token is available
     */
    function _pairAvailable(address _factory, address _tokenA, address _tokenB) internal view returns (bool) {
        return IUniswapV2Factory(_factory).getPair(_tokenA, _tokenB) != address(0);
    }
    
    /**
     * Returns the router address of a given exchange.
     * 
     * @param _exchange     The Exchange whose router address is needed
     * @return              IUniswapV2Router02 router of the given exchange
     */
     function _getRouter(Exchange _exchange) internal view returns(IUniswapV2Router02) {
         return (_exchange == Exchange.Uniswap) ? uniRouter : sushiRouter;
     }
    
}