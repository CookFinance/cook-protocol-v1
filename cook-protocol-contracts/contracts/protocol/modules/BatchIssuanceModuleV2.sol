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

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Math } from "@openzeppelin/contracts/math/Math.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/SafeCast.sol";
import { Address } from "@openzeppelin/contracts/utils/Address.sol";
import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";

import { IController } from "../../interfaces/IController.sol";
import { IIssuanceModule } from "../../interfaces/IIssuanceModule.sol";
import { ICKToken } from "../../interfaces/ICKToken.sol";
import { IWETH } from "../../interfaces/external/IWETH.sol";
import { ModuleBase } from "../lib/ModuleBase.sol";
import { PreciseUnitMath } from "../../lib/PreciseUnitMath.sol";

/**
 * @title BatchIssuanceModule
 * @author Cook Finance
 *
 * Module that enables batch issuance and redemption functionality on a CKToken, for the purpose of gas saving.
 * This is a module that is required to bring the totalSupply of a CK above 0.
 */
contract BatchIssuanceModuleV2 is ModuleBase, ReentrancyGuard {
    using PreciseUnitMath for uint256;
    using SafeMath for uint256;
    using Math for uint256;
    using SafeCast for int256;
    using SafeERC20 for IWETH;
    using SafeERC20 for IERC20;
    using Address for address;

    /* ============ Events ============ */

    event CKTokenBatchIssued(
        ICKToken indexed _ckToken,
        address _inputToken,
        uint256 _inputUsed,
        uint256 _outputCK,
        uint256 _roundNumber,
        uint256 _returnedAmount
    );
    event Deposit(ICKToken indexed _ckToken, address _to, uint256 _amount, uint256 _round);
    event WithdrawCKToken(
        ICKToken indexed _ckToken,
        address indexed _from,
        address indexed _to,
        uint256 _amount
    );
    event SlippageUpdated(ICKToken indexed _ckToken, uint256 _newSlippage);
    event PooledTokenUpdated(ICKToken indexed _ckToken, address _newPooledToken);
    event IncentiveUpdated(ICKToken indexed _ckToken, uint256 _newIncentive);

    /* ============ Structs ============ */

    struct BatchIssuanceSetting {
        address pooledToken;                       // token to pool for batch issue.
        uint256 slippage;                          // slippage in 18 decimals during issuance.
        uint256 incentive;                         // incentive in normal decimals for batch issuer.
    }

    struct RoundInfo {
        uint256 totalEthDeposited;                  // total deposited ETH amount in a round
        uint256 totalCkTokenIssued;                 // total issed ckToken in a round
    }

    /* ============ State Variables ============ */

    IWETH public immutable weth;                        // Wrapped ETH address
    IIssuanceModule public issuanceModule;              // Issuance Module
    
    // Mapping of CKToken to onoing batch issue round for deposit
    mapping(ICKToken => uint256) public roundNumbers;
    // Mapping of CKToken to round info
    mapping(ICKToken => mapping(uint256 => RoundInfo)) public roundInfos;
    // Mapping of CKToken to user deposit in a round, key is hashed by keccak256(user_address, round number)
    mapping(ICKToken => mapping(bytes32 => uint256)) public userDeposits;
    // Mapping of CkToken to pooling issue token
    mapping(ICKToken => BatchIssuanceSetting) public batchIssuanceSettings;

    /* ============ Constructor ============ */

    /**
     * Set state controller state variable
     *
     * @param _controller           Address of controller contract
     * @param _weth                 Address of WETH
     * @param _issuanceModule       Instance of issuance module
     */
    constructor(
        IController _controller,
        IWETH _weth,
        IIssuanceModule _issuanceModule
    ) public ModuleBase(_controller) {
        weth = _weth;
        // set issuance module
        issuanceModule = _issuanceModule;
    }

    /* ============ External Functions ============ */

    /**
     * Initializes this module to the CKToken with issuance settings and round input cap(limit)
     *
     * @param _ckToken              Instance of the CKToken to issue
     * @param _batchIssuanceSetting BatchIssuanceSetting struct define parameters
     */
    function initialize(
        ICKToken _ckToken,
        BatchIssuanceSetting memory _batchIssuanceSetting
    )
        external
        onlyCKManager(_ckToken, msg.sender)
        onlyValidAndPendingCK(_ckToken)
    {
        require(_ckToken.isInitializedModule(address(issuanceModule)), "IssuanceModule must be initialized");

        // assgin the first round
        roundNumbers[_ckToken] = 0;

        // set batch issuance setting
        batchIssuanceSettings[_ckToken] = _batchIssuanceSetting;

        // initialize module for the CKToken
        _ckToken.initializeModule();
    }

    /**
     * Mints the appropriate % of Net Asset Value of the CKToken from the deposited pooled token in the rounds.
     *
     * @param _ckToken                      Instance of the CKToken
     */
    function batchIssue(ICKToken _ckToken) external nonReentrant onlyValidAndInitializedCK(_ckToken) {
        // Get max input amount
        uint256 currentRound = roundNumbers[_ckToken];
        RoundInfo storage roundInfo = roundInfos[_ckToken][currentRound];
        uint256 maxInputAmount = roundInfo.totalEthDeposited;
        uint256 ckTokenBeforeBal = IERC20(_ckToken).balanceOf(address(this));

        require(maxInputAmount > 0, "Quantity must be > 0");
        IERC20 issuetoken = IERC20(batchIssuanceSettings[_ckToken].pooledToken);
        issuetoken.safeIncreaseAllowance(address(issuanceModule), maxInputAmount);
        uint256 toMintAmount = maxInputAmount.preciseMul(PreciseUnitMath.preciseUnit().sub(batchIssuanceSettings[_ckToken].incentive));

        // Mint the CKToken
        issuanceModule.issueWithSingleToken(_ckToken, address(issuetoken), toMintAmount, 10000000000000000, address(this), true);
        uint256 ckTokenAfterBal = IERC20(_ckToken).balanceOf(address(this));
        uint256 totalIssued = ckTokenAfterBal.sub(ckTokenBeforeBal);
        roundInfo.totalCkTokenIssued = totalIssued;

        // remain should be incentive plus what's returned from issuance module
        uint256 remainIssueTokenAmount = issuetoken.balanceOf(address(this));
        issuetoken.safeTransfer(msg.sender, remainIssueTokenAmount);

        emit CKTokenBatchIssued(_ckToken, address(issuetoken), maxInputAmount, totalIssued, currentRound, remainIssueTokenAmount);
        // round move forward
        roundNumbers[_ckToken] = currentRound.add(1);
    }

    /**
     * Wrap ETH and then deposit
     *
     * @param _ckToken                      Instance of the CKToken
     */
    function depositEth(ICKToken _ckToken) external payable onlyValidAndInitializedCK(_ckToken) {
        require(batchIssuanceSettings[_ckToken].pooledToken == address(weth), "pooled must be WETH");
        weth.deposit{ value: msg.value }();
        _depositTo(_ckToken, msg.value, msg.sender);
    }

    /**
     * Deposit pooled token
     *
     * @param _ckToken                      Instance of the CKToken
     * @param _amount                       Amount of pooled token
     */
    function deposit(ICKToken _ckToken, uint256 _amount) external onlyValidAndInitializedCK(_ckToken) {
        require(batchIssuanceSettings[_ckToken].pooledToken != address(0), "pooled token no specified");
        IERC20 issueToken = IERC20(batchIssuanceSettings[_ckToken].pooledToken);
        issueToken.safeTransferFrom(msg.sender, address(this), _amount);
        _depositTo(_ckToken, _amount, msg.sender);
    }

    /**
     * Withdraw CKToken
     *
     * @param _ckToken                      Instance of the CKToken
     */
    function withdrawCKToken(ICKToken _ckToken) external onlyValidAndInitializedCK(_ckToken) {
        withdrawCKTokenTo(_ckToken, msg.sender);
    }

    /**
     * Withdraw CKToken within to a specific address
     *
     * @param _ckToken                      Instance of the CKToken
     * @param _to                           Address to withdraw to
     */
    function withdrawCKTokenTo(
        ICKToken _ckToken,
        address _to
    ) public nonReentrant onlyValidAndInitializedCK(_ckToken) {
        uint256 totalWithdrawablwAmount = 0;
        uint256 currentRound = roundNumbers[_ckToken];

        for (uint256 i = 0; i < currentRound; i++) {
            bytes32 userRoundHash = _getUserRoundHash(_to, i);
            RoundInfo storage roundInfo = roundInfos[_ckToken][i];
            uint256 userDepositAmount = userDeposits[_ckToken][userRoundHash];

            // skip if user has no deposit, all ckToken withdraw or ckTokens not even issued
            if (userDepositAmount == 0 || roundInfo.totalEthDeposited == 0 || roundInfo.totalCkTokenIssued == 0) {
                continue;
            }

            uint256 withdrawablwAmount = roundInfo.totalCkTokenIssued.mul(userDepositAmount).div(roundInfo.totalEthDeposited);

            roundInfo.totalEthDeposited = roundInfo.totalEthDeposited.sub(userDeposits[_ckToken][userRoundHash]);
            roundInfo.totalCkTokenIssued = roundInfo.totalCkTokenIssued.sub(withdrawablwAmount);
            userDeposits[_ckToken][userRoundHash] = 0;

            totalWithdrawablwAmount = totalWithdrawablwAmount.add(withdrawablwAmount);
        }

        require(totalWithdrawablwAmount > 0, "no claimable ckToken");

        _ckToken.transfer(_to, totalWithdrawablwAmount);
        emit WithdrawCKToken(_ckToken, msg.sender, _to, totalWithdrawablwAmount);
    }

    /**
     * Update the slippage to batch issue cktoken.
     *
     * @param _ckToken                      Instance of the CKToken
     * @param _slippage                     The slippage in 18 decimals for issuing ckToken
     */
    function updateSlippage(ICKToken _ckToken, uint256 _slippage) 
        external
        onlyCKManager(_ckToken, msg.sender)
        onlyValidAndInitializedCK(_ckToken) {
            BatchIssuanceSetting storage batchIssuanceSetting = batchIssuanceSettings[_ckToken];
            batchIssuanceSetting.slippage = _slippage;
            emit SlippageUpdated(_ckToken, _slippage);
    }

    /**
     * Update the pooled token to batch issue cktoken.
     *
     * @param _ckToken                      Instance of the CKToken
     * @param _pooledToken                  The ERC20 to be pooled for batch issue.
     */
    function updatePooledToken(ICKToken _ckToken, address _pooledToken) 
        external 
        onlyCKManager(_ckToken, msg.sender)
        onlyValidAndInitializedCK(_ckToken) {
            uint256 currentRound = roundNumbers[_ckToken];
            RoundInfo memory roundInfo = roundInfos[_ckToken][currentRound];
            if (roundInfo.totalEthDeposited > 0) {
                require(roundInfo.totalCkTokenIssued > 0, "should drain batch first");
            }
            
            BatchIssuanceSetting storage batchIssuanceSetting = batchIssuanceSettings[_ckToken];
            batchIssuanceSetting.pooledToken = _pooledToken;
            emit PooledTokenUpdated(_ckToken, _pooledToken);
    }

    /**
     * Update the incentive to batch issue cktoken.
     *
     * @param _ckToken                      Instance of the CKToken
     * @param _incentive                    The incentive in 18 decimals for issuer
     */
    function updateIncentiveRate(ICKToken _ckToken, uint256 _incentive)
        external
        onlyCKManager(_ckToken, msg.sender)
        onlyValidAndInitializedCK(_ckToken) {
            BatchIssuanceSetting storage batchIssuanceSetting = batchIssuanceSettings[_ckToken];
            batchIssuanceSetting.incentive = _incentive;
            emit IncentiveUpdated(_ckToken, _incentive);
    }

    /**
     * Removes this module from the CKToken, via call by the CKToken.
     */
    function removeModule() external override {
        ICKToken ckToken_ = ICKToken(msg.sender);
        delete batchIssuanceSettings[ckToken_];
    }

    /* ============ External Getter Functions ============ */

    /**
     * Get deposited ETH waiting for batchIssue
     *
     * @param _ckToken                      Instance of the CKToken
     * @param _of                           address of the user
     */
     function inputBalanceOf(ICKToken _ckToken, address _of) public view returns(uint256) {
        uint256 currentRound = roundNumbers[_ckToken];
        bytes32 userRoundHash = _getUserRoundHash(_of, currentRound);
        return userDeposits[_ckToken][userRoundHash];
    }

    /**
     * Get batch issued ckToken of an address
     *
     * @param _ckToken                      Instance of the CKToken
     * @param _of                           address of the user
     */
    function outputBalanceOf(ICKToken _ckToken, address _of) public view returns(uint256) {
        uint256 currentRound = roundNumbers[_ckToken];
        uint256 totalWithdrawablwAmount = 0;

        for (uint256 i = 0; i < currentRound; i++) {
            bytes32 userRoundHash = _getUserRoundHash(_of, i);
            RoundInfo memory roundInfo = roundInfos[_ckToken][i];
            uint256 userDepositAmount = userDeposits[_ckToken][userRoundHash];

            // skip if user has no deposit, all ckToken withdraw or ckTokens not even issued
            if (userDepositAmount == 0 || roundInfo.totalEthDeposited == 0 || roundInfo.totalCkTokenIssued == 0) {
                continue;
            }

            uint256 withdrawablwAmount = roundInfo.totalCkTokenIssued.mul(userDepositAmount).div(roundInfo.totalEthDeposited);
            totalWithdrawablwAmount = totalWithdrawablwAmount.add(withdrawablwAmount);
        }        

        return totalWithdrawablwAmount;
    }

    /**
     * Get current batch issue round number 
     *
     * @param _ckToken                      Instance of the CKToken
     */
    function getCurrentRound(ICKToken _ckToken) public view returns(uint256) {
        return roundNumbers[_ckToken];
    }

    /**
     * Get current batch issue round deposited eth
     *
     * @param _ckToken                      Instance of the CKToken
     */
    function getCurrentRoundDeposited(ICKToken _ckToken) public view returns(uint256) {
        return roundInfos[_ckToken][roundNumbers[_ckToken]].totalEthDeposited;
    }

    /* ============ Internal Functions ============ */

    /**
     * Deposit by user
     *
     * @param _ckToken                      Instance of the CKToken
     * @param _amount                       Amount of pooled token
     * @param _to                           Address of depositor
     */
    function _depositTo(ICKToken _ckToken, uint256 _amount, address _to) internal {
        // if amount is zero return early
        if(_amount == 0) {
            return;
        }

        uint256 currentRound = roundNumbers[_ckToken];
        bytes32 userRoundHash = _getUserRoundHash(_to, currentRound);
        
        roundInfos[_ckToken][currentRound].totalEthDeposited = roundInfos[_ckToken][currentRound].totalEthDeposited.add(_amount);
        userDeposits[_ckToken][userRoundHash] = userDeposits[_ckToken][userRoundHash].add(_amount);

        emit Deposit(_ckToken, _to, _amount, currentRound);
    }

    /**
     * Generate hash key with (address, roundnumber) to get user deposit for a CKToken in a specific round.
     *
     * @param _account          Address made deposit
     * @param roundNumber       round an address deposited
     */
    function _getUserRoundHash(address _account, uint256 roundNumber) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(_account, roundNumber));
    }
}