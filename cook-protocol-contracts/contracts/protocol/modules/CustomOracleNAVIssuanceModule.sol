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
import { SafeCast } from "@openzeppelin/contracts/utils/SafeCast.sol";
import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";
import { SignedSafeMath } from "@openzeppelin/contracts/math/SignedSafeMath.sol";

import { AddressArrayUtils } from "../../lib/AddressArrayUtils.sol";
import { IController } from "../../interfaces/IController.sol";
import { ICKValuer } from "../../interfaces/ICKValuer.sol";
import { INAVIssuanceHook } from "../../interfaces/INAVIssuanceHook.sol";
import { Invoke } from "../lib/Invoke.sol";
import { ICKToken } from "../../interfaces/ICKToken.sol";
import { IWETH } from "../../interfaces/external/IWETH.sol";
import { ModuleBase } from "../lib/ModuleBase.sol";
import { Position } from "../lib/Position.sol";
import { PreciseUnitMath } from "../../lib/PreciseUnitMath.sol";
import { ResourceIdentifier } from "../lib/ResourceIdentifier.sol";

/**
 * @title CustomOracleNavIssuanceModule
 * @author Cook Finance
 *
 * Module that enables issuance and redemption with any valid ERC20 token or ETH if allowed by the manager. Sender receives
 * a proportional amount of CKTokens on issuance or ERC20 token on redemption based on the calculated net asset value using
 * oracle prices. Manager is able to enforce a premium / discount on issuance / redemption to avoid arbitrage and front
 * running when relying on oracle prices. Managers can charge a fee (denominated in reserve asset).
 */
contract CustomOracleNavIssuanceModule is ModuleBase, ReentrancyGuard {
    using AddressArrayUtils for address[];
    using Invoke for ICKToken;
    using Position for ICKToken;
    using PreciseUnitMath for uint256;
    using PreciseUnitMath for int256;
    using ResourceIdentifier for IController;
    using SafeMath for uint256;
    using SafeCast for int256;
    using SafeCast for uint256;
    using SignedSafeMath for int256;

    /* ============ Events ============ */

    event CKTokenNAVIssued(
        ICKToken indexed _ckToken,
        address _issuer,
        address _to,
        address _reserveAsset,
        address _hookContract,
        uint256 _ckTokenQuantity,
        uint256 _managerFee,
        uint256 _premium
    );

    event CKTokenNAVRedeemed(
        ICKToken indexed _ckToken,
        address _redeemer,
        address _to,
        address _reserveAsset,
        address _hookContract,
        uint256 _ckTokenQuantity,
        uint256 _managerFee,
        uint256 _premium
    );

    event ReserveAssetAdded(
        ICKToken indexed _ckToken,
        address _newReserveAsset
    );

    event ReserveAssetRemoved(
        ICKToken indexed _ckToken,
        address _removedReserveAsset
    );

    event PremiumEdited(
        ICKToken indexed _ckToken,
        uint256 _newPremium
    );

    event ManagerFeeEdited(
        ICKToken indexed _ckToken,
        uint256 _newManagerFee,
        uint256 _index
    );

    event FeeRecipientEdited(
        ICKToken indexed _ckToken,
        address _feeRecipient
    );

    /* ============ Structs ============ */

    struct NAVIssuanceSettings {
        INAVIssuanceHook managerIssuanceHook;          // Issuance hook configurations
        INAVIssuanceHook managerRedemptionHook;        // Redemption hook configurations
        ICKValuer ckValuer;                          // Optional custom ck valuer. If address(0) is provided, fetch the default one from the controller
        address[] reserveAssets;                       // Allowed reserve assets - Must have a price enabled with the price oracle
        address feeRecipient;                          // Manager fee recipient
        uint256[2] managerFees;                        // Manager fees. 0 index is issue and 1 index is redeem fee (0.01% = 1e14, 1% = 1e16)
        uint256 maxManagerFee;                         // Maximum fee manager is allowed to ck for issue and redeem
        uint256 premiumPercentage;                     // Premium percentage (0.01% = 1e14, 1% = 1e16). This premium is a buffer around oracle
                                                       // prices paid by user to the CKToken, which prevents arbitrage and oracle front running
        uint256 maxPremiumPercentage;                  // Maximum premium percentage manager is allowed to ck (configured by manager)
        uint256 minCKTokenSupply;                     // Minimum CKToken supply required for issuance and redemption 
                                                       // to prevent dramatic inflationary changes to the CKToken's position multiplier
    }

    struct ActionInfo {
        uint256 preFeeReserveQuantity;                 // Reserve value before fees; During issuance, represents raw quantity
                                                       // During redeem, represents post-premium value
        uint256 protocolFees;                          // Total protocol fees (direct + manager revenue share)
        uint256 managerFee;                            // Total manager fee paid in reserve asset
        uint256 netFlowQuantity;                       // When issuing, quantity of reserve asset sent to CKToken
                                                       // When redeeming, quantity of reserve asset sent to redeemer
        uint256 ckTokenQuantity;                      // When issuing, quantity of CKTokens minted to mintee
                                                       // When redeeming, quantity of CKToken redeemed
        uint256 previousCKTokenSupply;                // CKToken supply prior to issue/redeem action
        uint256 newCKTokenSupply;                     // CKToken supply after issue/redeem action
        int256 newPositionMultiplier;                  // CKToken position multiplier after issue/redeem
        uint256 newReservePositionUnit;                // CKToken reserve asset position unit after issue/redeem
    }

    /* ============ State Variables ============ */

    // Wrapped ETH address
    IWETH public immutable weth;

    // Mapping of CKToken to NAV issuance settings struct
    mapping(ICKToken => NAVIssuanceSettings) public navIssuanceSettings;
    
    // Mapping to efficiently check a CKToken's reserve asset validity
    // CKToken => reserveAsset => isReserveAsset
    mapping(ICKToken => mapping(address => bool)) public isReserveAsset;

    /* ============ Constants ============ */

    // 0 index stores the manager fee in managerFees array, percentage charged on issue (denominated in reserve asset)
    uint256 constant internal MANAGER_ISSUE_FEE_INDEX = 0;

    // 1 index stores the manager fee percentage in managerFees array, charged on redeem
    uint256 constant internal MANAGER_REDEEM_FEE_INDEX = 1;

    // 0 index stores the manager revenue share protocol fee % on the controller, charged in the issuance function
    uint256 constant internal PROTOCOL_ISSUE_MANAGER_REVENUE_SHARE_FEE_INDEX = 0;

    // 1 index stores the manager revenue share protocol fee % on the controller, charged in the redeem function
    uint256 constant internal PROTOCOL_REDEEM_MANAGER_REVENUE_SHARE_FEE_INDEX = 1;

    // 2 index stores the direct protocol fee % on the controller, charged in the issuance function
    uint256 constant internal PROTOCOL_ISSUE_DIRECT_FEE_INDEX = 2;

    // 3 index stores the direct protocol fee % on the controller, charged in the redeem function
    uint256 constant internal PROTOCOL_REDEEM_DIRECT_FEE_INDEX = 3;

    /* ============ Constructor ============ */

    /**
     * @param _controller               Address of controller contract
     * @param _weth                     Address of wrapped eth
     */
    constructor(IController _controller, IWETH _weth) public ModuleBase(_controller) {
        weth = _weth;
    }

    /* ============ External Functions ============ */
    
    /**
     * Deposits the allowed reserve asset into the CKToken and mints the appropriate % of Net Asset Value of the CKToken
     * to the specified _to address.
     *
     * @param _ckToken                     Instance of the CKToken contract
     * @param _reserveAsset                 Address of the reserve asset to issue with
     * @param _reserveAssetQuantity         Quantity of the reserve asset to issue with
     * @param _minCKTokenReceiveQuantity   Min quantity of CKToken to receive after issuance
     * @param _to                           Address to mint CKToken to
     */
    function issue(
        ICKToken _ckToken,
        address _reserveAsset,
        uint256 _reserveAssetQuantity,
        uint256 _minCKTokenReceiveQuantity,
        address _to
    ) 
        external
        nonReentrant
        onlyValidAndInitializedCK(_ckToken)
    {
        _validateCommon(_ckToken, _reserveAsset, _reserveAssetQuantity);
        
        _callPreIssueHooks(_ckToken, _reserveAsset, _reserveAssetQuantity, msg.sender, _to);

        ActionInfo memory issueInfo = _createIssuanceInfo(_ckToken, _reserveAsset, _reserveAssetQuantity);

        _validateIssuanceInfo(_ckToken, _minCKTokenReceiveQuantity, issueInfo);

        _transferCollateralAndHandleFees(_ckToken, IERC20(_reserveAsset), issueInfo);

        _handleIssueStateUpdates(_ckToken, _reserveAsset, _to, issueInfo);
    }

    /**
     * Wraps ETH and deposits WETH if allowed into the CKToken and mints the appropriate % of Net Asset Value of the CKToken
     * to the specified _to address.
     *
     * @param _ckToken                     Instance of the CKToken contract
     * @param _minCKTokenReceiveQuantity   Min quantity of CKToken to receive after issuance
     * @param _to                           Address to mint CKToken to
     */
    function issueWithEther(
        ICKToken _ckToken,
        uint256 _minCKTokenReceiveQuantity,
        address _to
    ) 
        external
        payable
        nonReentrant
        onlyValidAndInitializedCK(_ckToken)
    {
        weth.deposit{ value: msg.value }();

        _validateCommon(_ckToken, address(weth), msg.value);
        
        _callPreIssueHooks(_ckToken, address(weth), msg.value, msg.sender, _to);

        ActionInfo memory issueInfo = _createIssuanceInfo(_ckToken, address(weth), msg.value);

        _validateIssuanceInfo(_ckToken, _minCKTokenReceiveQuantity, issueInfo);

        _transferWETHAndHandleFees(_ckToken, issueInfo);

        _handleIssueStateUpdates(_ckToken, address(weth), _to, issueInfo);
    }

    /**
     * Redeems a CKToken into a valid reserve asset representing the appropriate % of Net Asset Value of the CKToken
     * to the specified _to address. Only valid if there are available reserve units on the CKToken.
     *
     * @param _ckToken                     Instance of the CKToken contract
     * @param _reserveAsset                 Address of the reserve asset to redeem with
     * @param _ckTokenQuantity             Quantity of CKTokens to redeem
     * @param _minReserveReceiveQuantity    Min quantity of reserve asset to receive
     * @param _to                           Address to redeem reserve asset to
     */
    function redeem(
        ICKToken _ckToken,
        address _reserveAsset,
        uint256 _ckTokenQuantity,
        uint256 _minReserveReceiveQuantity,
        address _to
    ) 
        external
        nonReentrant
        onlyValidAndInitializedCK(_ckToken)
    {
        _validateCommon(_ckToken, _reserveAsset, _ckTokenQuantity);

        _callPreRedeemHooks(_ckToken, _ckTokenQuantity, msg.sender, _to);

        ActionInfo memory redeemInfo = _createRedemptionInfo(_ckToken, _reserveAsset, _ckTokenQuantity);

        _validateRedemptionInfo(_ckToken, _minReserveReceiveQuantity, _ckTokenQuantity, redeemInfo);

        _ckToken.burn(msg.sender, _ckTokenQuantity);

        // Instruct the CKToken to transfer the reserve asset back to the user
        _ckToken.strictInvokeTransfer(
            _reserveAsset,
            _to,
            redeemInfo.netFlowQuantity
        );

        _handleRedemptionFees(_ckToken, _reserveAsset, redeemInfo);

        _handleRedeemStateUpdates(_ckToken, _reserveAsset, _to, redeemInfo);
    }

    /**
     * Redeems a CKToken into Ether (if WETH is valid) representing the appropriate % of Net Asset Value of the CKToken
     * to the specified _to address. Only valid if there are available WETH units on the CKToken.
     *
     * @param _ckToken                     Instance of the CKToken contract
     * @param _ckTokenQuantity             Quantity of CKTokens to redeem
     * @param _minReserveReceiveQuantity    Min quantity of reserve asset to receive
     * @param _to                           Address to redeem reserve asset to
     */
    function redeemIntoEther(
        ICKToken _ckToken,
        uint256 _ckTokenQuantity,
        uint256 _minReserveReceiveQuantity,
        address payable _to
    ) 
        external
        nonReentrant
        onlyValidAndInitializedCK(_ckToken)
    {
        _validateCommon(_ckToken, address(weth), _ckTokenQuantity);

        _callPreRedeemHooks(_ckToken, _ckTokenQuantity, msg.sender, _to);

        ActionInfo memory redeemInfo = _createRedemptionInfo(_ckToken, address(weth), _ckTokenQuantity);

        _validateRedemptionInfo(_ckToken, _minReserveReceiveQuantity, _ckTokenQuantity, redeemInfo);

        _ckToken.burn(msg.sender, _ckTokenQuantity);

        // Instruct the CKToken to transfer WETH from CKToken to module
        _ckToken.strictInvokeTransfer(
            address(weth),
            address(this),
            redeemInfo.netFlowQuantity
        );

        weth.withdraw(redeemInfo.netFlowQuantity);
        
        _to.transfer(redeemInfo.netFlowQuantity);

        _handleRedemptionFees(_ckToken, address(weth), redeemInfo);

        _handleRedeemStateUpdates(_ckToken, address(weth), _to, redeemInfo);
    }

    /**
     * CK MANAGER ONLY. Add an allowed reserve asset
     *
     * @param _ckToken                     Instance of the CKToken
     * @param _reserveAsset                 Address of the reserve asset to add
     */
    function addReserveAsset(ICKToken _ckToken, address _reserveAsset) external onlyManagerAndValidCK(_ckToken) {
        require(!isReserveAsset[_ckToken][_reserveAsset], "Reserve asset already exists");
        
        navIssuanceSettings[_ckToken].reserveAssets.push(_reserveAsset);
        isReserveAsset[_ckToken][_reserveAsset] = true;

        emit ReserveAssetAdded(_ckToken, _reserveAsset);
    }

    /**
     * CK MANAGER ONLY. Remove a reserve asset
     *
     * @param _ckToken                     Instance of the CKToken
     * @param _reserveAsset                 Address of the reserve asset to remove
     */
    function removeReserveAsset(ICKToken _ckToken, address _reserveAsset) external onlyManagerAndValidCK(_ckToken) {
        require(isReserveAsset[_ckToken][_reserveAsset], "Reserve asset does not exist");

        navIssuanceSettings[_ckToken].reserveAssets = navIssuanceSettings[_ckToken].reserveAssets.remove(_reserveAsset);
        delete isReserveAsset[_ckToken][_reserveAsset];

        emit ReserveAssetRemoved(_ckToken, _reserveAsset);
    }

    /**
     * CK MANAGER ONLY. Edit the premium percentage
     *
     * @param _ckToken                     Instance of the CKToken
     * @param _premiumPercentage            Premium percentage in 10e16 (e.g. 10e16 = 1%)
     */
    function editPremium(ICKToken _ckToken, uint256 _premiumPercentage) external onlyManagerAndValidCK(_ckToken) {
        require(_premiumPercentage <= navIssuanceSettings[_ckToken].maxPremiumPercentage, "Premium must be less than maximum allowed");
        
        navIssuanceSettings[_ckToken].premiumPercentage = _premiumPercentage;

        emit PremiumEdited(_ckToken, _premiumPercentage);
    }

    /**
     * CK MANAGER ONLY. Edit manager fee
     *
     * @param _ckToken                     Instance of the CKToken
     * @param _managerFeePercentage         Manager fee percentage in 10e16 (e.g. 10e16 = 1%)
     * @param _managerFeeIndex              Manager fee index. 0 index is issue fee, 1 index is redeem fee
     */
    function editManagerFee(
        ICKToken _ckToken,
        uint256 _managerFeePercentage,
        uint256 _managerFeeIndex
    )
        external
        onlyManagerAndValidCK(_ckToken)
    {
        require(_managerFeePercentage <= navIssuanceSettings[_ckToken].maxManagerFee, "Manager fee must be less than maximum allowed");
        
        navIssuanceSettings[_ckToken].managerFees[_managerFeeIndex] = _managerFeePercentage;

        emit ManagerFeeEdited(_ckToken, _managerFeePercentage, _managerFeeIndex);
    }

    /**
     * CK MANAGER ONLY. Edit the manager fee recipient
     *
     * @param _ckToken                     Instance of the CKToken
     * @param _managerFeeRecipient          Manager fee recipient
     */
    function editFeeRecipient(ICKToken _ckToken, address _managerFeeRecipient) external onlyManagerAndValidCK(_ckToken) {
        require(_managerFeeRecipient != address(0), "Fee recipient must not be 0 address");
        
        navIssuanceSettings[_ckToken].feeRecipient = _managerFeeRecipient;

        emit FeeRecipientEdited(_ckToken, _managerFeeRecipient);
    }

    /**
     * CK MANAGER ONLY. Initializes this module to the CKToken with hooks, allowed reserve assets,
     * fees and issuance premium. Only callable by the CKToken's manager. Hook addresses are optional.
     * Address(0) means that no hook will be called.
     *
     * @param _ckToken                     Instance of the CKToken to issue
     * @param _navIssuanceSettings          NAVIssuanceSettings struct defining parameters
     */
    function initialize(
        ICKToken _ckToken,
        NAVIssuanceSettings memory _navIssuanceSettings
    )
        external
        onlyCKManager(_ckToken, msg.sender)
        onlyValidAndPendingCK(_ckToken)
    {
        require(_navIssuanceSettings.reserveAssets.length > 0, "Reserve assets must be greater than 0");
        require(_navIssuanceSettings.maxManagerFee < PreciseUnitMath.preciseUnit(), "Max manager fee must be less than 100%");
        require(_navIssuanceSettings.maxPremiumPercentage < PreciseUnitMath.preciseUnit(), "Max premium percentage must be less than 100%");
        require(_navIssuanceSettings.managerFees[0] <= _navIssuanceSettings.maxManagerFee, "Manager issue fee must be less than max");
        require(_navIssuanceSettings.managerFees[1] <= _navIssuanceSettings.maxManagerFee, "Manager redeem fee must be less than max");
        require(_navIssuanceSettings.premiumPercentage <= _navIssuanceSettings.maxPremiumPercentage, "Premium must be less than max");
        require(_navIssuanceSettings.feeRecipient != address(0), "Fee Recipient must be non-zero address.");
        // Initial mint of Set cannot use NAVIssuance since minCKTokenSupply must be > 0
        require(_navIssuanceSettings.minCKTokenSupply > 0, "Min CKToken supply must be greater than 0");

        for (uint256 i = 0; i < _navIssuanceSettings.reserveAssets.length; i++) {
            require(!isReserveAsset[_ckToken][_navIssuanceSettings.reserveAssets[i]], "Reserve assets must be unique");
            isReserveAsset[_ckToken][_navIssuanceSettings.reserveAssets[i]] = true;
        }

        navIssuanceSettings[_ckToken] = _navIssuanceSettings;

        _ckToken.initializeModule();
    }

    /**
     * Removes this module from the CKToken, via call by the CKToken. Issuance settings and
     * reserve asset states are deleted.
     */
    function removeModule() external override {
        ICKToken ckToken = ICKToken(msg.sender);
        for (uint256 i = 0; i < navIssuanceSettings[ckToken].reserveAssets.length; i++) {
            delete isReserveAsset[ckToken][navIssuanceSettings[ckToken].reserveAssets[i]];
        }
        
        delete navIssuanceSettings[ckToken];
    }

    receive() external payable {}

    /* ============ External Getter Functions ============ */

    function getReserveAssets(ICKToken _ckToken) external view returns (address[] memory) {
        return navIssuanceSettings[_ckToken].reserveAssets;
    }

    function getIssuePremium(
        ICKToken _ckToken,
        address _reserveAsset,
        uint256 _reserveAssetQuantity
    )
        external
        view
        returns (uint256)
    {
        return _getIssuePremium(_ckToken, _reserveAsset, _reserveAssetQuantity);
    }

    function getRedeemPremium(
        ICKToken _ckToken,
        address _reserveAsset,
        uint256 _ckTokenQuantity
    )
        external
        view
        returns (uint256)
    {
        return _getRedeemPremium(_ckToken, _reserveAsset, _ckTokenQuantity);
    }

    function getManagerFee(ICKToken _ckToken, uint256 _managerFeeIndex) external view returns (uint256) {
        return navIssuanceSettings[_ckToken].managerFees[_managerFeeIndex];
    }

    /**
     * Get the expected CKTokens minted to recipient on issuance
     *
     * @param _ckToken                     Instance of the CKToken
     * @param _reserveAsset                 Address of the reserve asset
     * @param _reserveAssetQuantity         Quantity of the reserve asset to issue with
     *
     * @return  uint256                     Expected CKTokens to be minted to recipient
     */
    function getExpectedCKTokenIssueQuantity(
        ICKToken _ckToken,
        address _reserveAsset,
        uint256 _reserveAssetQuantity
    )
        external
        view
        returns (uint256)
    {
        (,, uint256 netReserveFlow) = _getFees(
            _ckToken,
            _reserveAssetQuantity,
            PROTOCOL_ISSUE_MANAGER_REVENUE_SHARE_FEE_INDEX,
            PROTOCOL_ISSUE_DIRECT_FEE_INDEX,
            MANAGER_ISSUE_FEE_INDEX
        );

        uint256 ckTotalSupply = _ckToken.totalSupply();

        return _getCKTokenMintQuantity(
            _ckToken,
            _reserveAsset,
            netReserveFlow,
            ckTotalSupply
        );
    }

    /**
     * Get the expected reserve asset to be redeemed
     *
     * @param _ckToken                     Instance of the CKToken
     * @param _reserveAsset                 Address of the reserve asset
     * @param _ckTokenQuantity             Quantity of CKTokens to redeem
     *
     * @return  uint256                     Expected reserve asset quantity redeemed
     */
    function getExpectedReserveRedeemQuantity(
        ICKToken _ckToken,
        address _reserveAsset,
        uint256 _ckTokenQuantity
    )
        external
        view
        returns (uint256)
    {
        uint256 preFeeReserveQuantity = _getRedeemReserveQuantity(_ckToken, _reserveAsset, _ckTokenQuantity);

        (,, uint256 netReserveFlows) = _getFees(
            _ckToken,
            preFeeReserveQuantity,
            PROTOCOL_REDEEM_MANAGER_REVENUE_SHARE_FEE_INDEX,
            PROTOCOL_REDEEM_DIRECT_FEE_INDEX,
            MANAGER_REDEEM_FEE_INDEX
        );

        return netReserveFlows;
    }

    /**
     * Checks if issue is valid
     *
     * @param _ckToken                     Instance of the CKToken
     * @param _reserveAsset                 Address of the reserve asset
     * @param _reserveAssetQuantity         Quantity of the reserve asset to issue with
     *
     * @return  bool                        Returns true if issue is valid
     */
    function isIssueValid(
        ICKToken _ckToken,
        address _reserveAsset,
        uint256 _reserveAssetQuantity
    )
        external
        view
        returns (bool)
    {
        uint256 ckTotalSupply = _ckToken.totalSupply();

    return _reserveAssetQuantity != 0
            && isReserveAsset[_ckToken][_reserveAsset]
            && ckTotalSupply >= navIssuanceSettings[_ckToken].minCKTokenSupply;
    }

    /**
     * Checks if redeem is valid
     *
     * @param _ckToken                     Instance of the CKToken
     * @param _reserveAsset                 Address of the reserve asset
     * @param _ckTokenQuantity             Quantity of CKTokens to redeem
     *
     * @return  bool                        Returns true if redeem is valid
     */
    function isRedeemValid(
        ICKToken _ckToken,
        address _reserveAsset,
        uint256 _ckTokenQuantity
    )
        external
        view
        returns (bool)
    {
        uint256 ckTotalSupply = _ckToken.totalSupply();

        if (
            _ckTokenQuantity == 0
            || !isReserveAsset[_ckToken][_reserveAsset]
            || ckTotalSupply < navIssuanceSettings[_ckToken].minCKTokenSupply.add(_ckTokenQuantity)
        ) {
            return false;
        } else {
            uint256 totalRedeemValue =_getRedeemReserveQuantity(_ckToken, _reserveAsset, _ckTokenQuantity);

            (,, uint256 expectedRedeemQuantity) = _getFees(
                _ckToken,
                totalRedeemValue,
                PROTOCOL_REDEEM_MANAGER_REVENUE_SHARE_FEE_INDEX,
                PROTOCOL_REDEEM_DIRECT_FEE_INDEX,
                MANAGER_REDEEM_FEE_INDEX
            );

            uint256 existingUnit = _ckToken.getDefaultPositionRealUnit(_reserveAsset).toUint256();

            return existingUnit.preciseMul(ckTotalSupply) >= expectedRedeemQuantity;
        }
    }

    /* ============ Internal Functions ============ */

    function _validateCommon(ICKToken _ckToken, address _reserveAsset, uint256 _quantity) internal view {
        require(_quantity > 0, "Quantity must be > 0");
        require(isReserveAsset[_ckToken][_reserveAsset], "Must be valid reserve asset");
    }

    function _validateIssuanceInfo(ICKToken _ckToken, uint256 _minCKTokenReceiveQuantity, ActionInfo memory _issueInfo) internal view {
        // Check that total supply is greater than min supply needed for issuance
        // Note: A min supply amount is needed to avoid division by 0 when CKToken supply is 0
        require(
            _issueInfo.previousCKTokenSupply >= navIssuanceSettings[_ckToken].minCKTokenSupply,
            "Supply must be greater than minimum to enable issuance"
        );

        require(_issueInfo.ckTokenQuantity >= _minCKTokenReceiveQuantity, "Must be greater than min CKToken");
    }

    function _validateRedemptionInfo(
        ICKToken _ckToken,
        uint256 _minReserveReceiveQuantity,
        uint256 _ckTokenQuantity,
        ActionInfo memory _redeemInfo
    )
        internal
        view
    {
        // Check that new supply is more than min supply needed for redemption
        // Note: A min supply amount is needed to avoid division by 0 when redeeming CKToken to 0
        require(
            _redeemInfo.newCKTokenSupply >= navIssuanceSettings[_ckToken].minCKTokenSupply,
            "Supply must be greater than minimum to enable redemption"
        );

        require(_redeemInfo.netFlowQuantity >= _minReserveReceiveQuantity, "Must be greater than min receive reserve quantity");
    }

    function _createIssuanceInfo(
        ICKToken _ckToken,
        address _reserveAsset,
        uint256 _reserveAssetQuantity
    )
        internal
        view
        returns (ActionInfo memory)
    {
        ActionInfo memory issueInfo;

        issueInfo.previousCKTokenSupply = _ckToken.totalSupply();

        issueInfo.preFeeReserveQuantity = _reserveAssetQuantity;

        (issueInfo.protocolFees, issueInfo.managerFee, issueInfo.netFlowQuantity) = _getFees(
            _ckToken,
            issueInfo.preFeeReserveQuantity,
            PROTOCOL_ISSUE_MANAGER_REVENUE_SHARE_FEE_INDEX,
            PROTOCOL_ISSUE_DIRECT_FEE_INDEX,
            MANAGER_ISSUE_FEE_INDEX
        );

        issueInfo.ckTokenQuantity = _getCKTokenMintQuantity(
            _ckToken,
            _reserveAsset,
            issueInfo.netFlowQuantity,
            issueInfo.previousCKTokenSupply
        );

        (issueInfo.newCKTokenSupply, issueInfo.newPositionMultiplier) = _getIssuePositionMultiplier(_ckToken, issueInfo);

        issueInfo.newReservePositionUnit = _getIssuePositionUnit(_ckToken, _reserveAsset, issueInfo);

        return issueInfo;
    }

    function _createRedemptionInfo(
        ICKToken _ckToken,
        address _reserveAsset,
        uint256 _ckTokenQuantity
    )
        internal
        view
        returns (ActionInfo memory)
    {
        ActionInfo memory redeemInfo;

        redeemInfo.ckTokenQuantity = _ckTokenQuantity;

        redeemInfo.preFeeReserveQuantity =_getRedeemReserveQuantity(_ckToken, _reserveAsset, _ckTokenQuantity);

        (redeemInfo.protocolFees, redeemInfo.managerFee, redeemInfo.netFlowQuantity) = _getFees(
            _ckToken,
            redeemInfo.preFeeReserveQuantity,
            PROTOCOL_REDEEM_MANAGER_REVENUE_SHARE_FEE_INDEX,
            PROTOCOL_REDEEM_DIRECT_FEE_INDEX,
            MANAGER_REDEEM_FEE_INDEX
        );

        redeemInfo.previousCKTokenSupply = _ckToken.totalSupply();

        (redeemInfo.newCKTokenSupply, redeemInfo.newPositionMultiplier) = _getRedeemPositionMultiplier(_ckToken, _ckTokenQuantity, redeemInfo);

        redeemInfo.newReservePositionUnit = _getRedeemPositionUnit(_ckToken, _reserveAsset, redeemInfo);

        return redeemInfo;
    }

    /**
     * Transfer reserve asset from user to CKToken and fees from user to appropriate fee recipients
     */
    function _transferCollateralAndHandleFees(ICKToken _ckToken, IERC20 _reserveAsset, ActionInfo memory _issueInfo) internal {
        transferFrom(_reserveAsset, msg.sender, address(_ckToken), _issueInfo.netFlowQuantity);

        if (_issueInfo.protocolFees > 0) {
            transferFrom(_reserveAsset, msg.sender, controller.feeRecipient(), _issueInfo.protocolFees);
        }

        if (_issueInfo.managerFee > 0) {
            transferFrom(_reserveAsset, msg.sender, navIssuanceSettings[_ckToken].feeRecipient, _issueInfo.managerFee);
        }
    }


    /**
      * Transfer WETH from module to CKToken and fees from module to appropriate fee recipients
     */
    function _transferWETHAndHandleFees(ICKToken _ckToken, ActionInfo memory _issueInfo) internal {
        weth.transfer(address(_ckToken), _issueInfo.netFlowQuantity);

        if (_issueInfo.protocolFees > 0) {
            weth.transfer(controller.feeRecipient(), _issueInfo.protocolFees);
        }

        if (_issueInfo.managerFee > 0) {
            weth.transfer(navIssuanceSettings[_ckToken].feeRecipient, _issueInfo.managerFee);
        }
    }

    function _handleIssueStateUpdates(
        ICKToken _ckToken,
        address _reserveAsset,
        address _to,
        ActionInfo memory _issueInfo
    ) 
        internal
    {
        _ckToken.editPositionMultiplier(_issueInfo.newPositionMultiplier);

        _ckToken.editDefaultPosition(_reserveAsset, _issueInfo.newReservePositionUnit);

        _ckToken.mint(_to, _issueInfo.ckTokenQuantity);

        emit CKTokenNAVIssued(
            _ckToken,
            msg.sender,
            _to,
            _reserveAsset,
            address(navIssuanceSettings[_ckToken].managerIssuanceHook),
            _issueInfo.ckTokenQuantity,
            _issueInfo.managerFee,
            _issueInfo.protocolFees
        );        
    }

    function _handleRedeemStateUpdates(
        ICKToken _ckToken,
        address _reserveAsset,
        address _to,
        ActionInfo memory _redeemInfo
    ) 
        internal
    {
        _ckToken.editPositionMultiplier(_redeemInfo.newPositionMultiplier);

        _ckToken.editDefaultPosition(_reserveAsset, _redeemInfo.newReservePositionUnit);

        emit CKTokenNAVRedeemed(
            _ckToken,
            msg.sender,
            _to,
            _reserveAsset,
            address(navIssuanceSettings[_ckToken].managerRedemptionHook),
            _redeemInfo.ckTokenQuantity,
            _redeemInfo.managerFee,
            _redeemInfo.protocolFees
        );      
    }

    function _handleRedemptionFees(ICKToken _ckToken, address _reserveAsset, ActionInfo memory _redeemInfo) internal {
        // Instruct the CKToken to transfer protocol fee to fee recipient if there is a fee
        payProtocolFeeFromCKToken(_ckToken, _reserveAsset, _redeemInfo.protocolFees);

        // Instruct the CKToken to transfer manager fee to manager fee recipient if there is a fee
        if (_redeemInfo.managerFee > 0) {
            _ckToken.strictInvokeTransfer(
                _reserveAsset,
                navIssuanceSettings[_ckToken].feeRecipient,
                _redeemInfo.managerFee
            );
        }
    }

    /**
     * Returns the issue premium percentage. Virtual function that can be overridden in future versions of the module
     * and can contain arbitrary logic to calculate the issuance premium.
     */
    function _getIssuePremium(
        ICKToken _ckToken,
        address /* _reserveAsset */,
        uint256 /* _reserveAssetQuantity */
    )
        virtual
        internal
        view
        returns (uint256)
    {
        return navIssuanceSettings[_ckToken].premiumPercentage;
    }

    /**
     * Returns the redeem premium percentage. Virtual function that can be overridden in future versions of the module
     * and can contain arbitrary logic to calculate the redemption premium.
     */
    function _getRedeemPremium(
        ICKToken _ckToken,
        address /* _reserveAsset */,
        uint256 /* _ckTokenQuantity */
    )
        virtual
        internal
        view
        returns (uint256)
    {
        return navIssuanceSettings[_ckToken].premiumPercentage;
    }

    /**
     * Returns the fees attributed to the manager and the protocol. The fees are calculated as follows:
     *
     * ManagerFee = (manager fee % - % to protocol) * reserveAssetQuantity
     * Protocol Fee = (% manager fee share + direct fee %) * reserveAssetQuantity
     *
     * @param _ckToken                     Instance of the CKToken
     * @param _reserveAssetQuantity         Quantity of reserve asset to calculate fees from
     * @param _protocolManagerFeeIndex      Index to pull rev share NAV Issuance fee from the Controller
     * @param _protocolDirectFeeIndex       Index to pull direct NAV issuance fee from the Controller
     * @param _managerFeeIndex              Index from NAVIssuanceSettings (0 = issue fee, 1 = redeem fee)
     *
     * @return  uint256                     Fees paid to the protocol in reserve asset
     * @return  uint256                     Fees paid to the manager in reserve asset
     * @return  uint256                     Net reserve to user net of fees
     */
    function _getFees(
        ICKToken _ckToken,
        uint256 _reserveAssetQuantity,
        uint256 _protocolManagerFeeIndex,
        uint256 _protocolDirectFeeIndex,
        uint256 _managerFeeIndex
    )
        internal
        view
        returns (uint256, uint256, uint256)
    {
        (uint256 protocolFeePercentage, uint256 managerFeePercentage) = _getProtocolAndManagerFeePercentages(
            _ckToken,
            _protocolManagerFeeIndex,
            _protocolDirectFeeIndex,
            _managerFeeIndex
        );

        // Calculate total notional fees
        uint256 protocolFees = protocolFeePercentage.preciseMul(_reserveAssetQuantity);
        uint256 managerFee = managerFeePercentage.preciseMul(_reserveAssetQuantity);

        uint256 netReserveFlow = _reserveAssetQuantity.sub(protocolFees).sub(managerFee);

        return (protocolFees, managerFee, netReserveFlow);
    }

    function _getProtocolAndManagerFeePercentages(
        ICKToken _ckToken,
        uint256 _protocolManagerFeeIndex,
        uint256 _protocolDirectFeeIndex,
        uint256 _managerFeeIndex
    )
        internal
        view
        returns(uint256, uint256)
    {
        // Get protocol fee percentages
        uint256 protocolDirectFeePercent = controller.getModuleFee(address(this), _protocolDirectFeeIndex);
        uint256 protocolManagerShareFeePercent = controller.getModuleFee(address(this), _protocolManagerFeeIndex);
        uint256 managerFeePercent = navIssuanceSettings[_ckToken].managerFees[_managerFeeIndex];
        
        // Calculate revenue share split percentage
        uint256 protocolRevenueSharePercentage = protocolManagerShareFeePercent.preciseMul(managerFeePercent);
        uint256 managerRevenueSharePercentage = managerFeePercent.sub(protocolRevenueSharePercentage);
        uint256 totalProtocolFeePercentage = protocolRevenueSharePercentage.add(protocolDirectFeePercent);

        return (totalProtocolFeePercentage, managerRevenueSharePercentage);
    }

    function _getCKTokenMintQuantity(
        ICKToken _ckToken,
        address _reserveAsset,
        uint256 _netReserveFlows,            // Value of reserve asset net of fees
        uint256 _ckTotalSupply
    )
        internal
        view
        returns (uint256)
    {
        uint256 premiumPercentage = _getIssuePremium(_ckToken, _reserveAsset, _netReserveFlows);
        uint256 premiumValue = _netReserveFlows.preciseMul(premiumPercentage);

        // If the set manager provided a custom valuer at initialization time, use it. Otherwise get it from the controller
        // Get valuation of the CKToken with the quote asset as the reserve asset. Returns value in precise units (1e18)
        // Reverts if price is not found
        uint256 ckTokenValuation = _getCKValuer(_ckToken).calculateCKTokenValuation(_ckToken, _reserveAsset);

        // Get reserve asset decimals
        uint256 reserveAssetDecimals = ERC20(_reserveAsset).decimals();
        uint256 normalizedTotalReserveQuantityNetFees = _netReserveFlows.preciseDiv(10 ** reserveAssetDecimals);
        uint256 normalizedTotalReserveQuantityNetFeesAndPremium = _netReserveFlows.sub(premiumValue).preciseDiv(10 ** reserveAssetDecimals);

        // Calculate CKTokens to mint to issuer
        uint256 denominator = _ckTotalSupply.preciseMul(ckTokenValuation).add(normalizedTotalReserveQuantityNetFees).sub(normalizedTotalReserveQuantityNetFeesAndPremium);
        return normalizedTotalReserveQuantityNetFeesAndPremium.preciseMul(_ckTotalSupply).preciseDiv(denominator);
    }

    function _getRedeemReserveQuantity(
        ICKToken _ckToken,
        address _reserveAsset,
        uint256 _ckTokenQuantity
    )
        internal
        view
        returns (uint256)
    {
        // Get valuation of the CKToken with the quote asset as the reserve asset. Returns value in precise units (10e18)
        // Reverts if price is not found
        uint256 ckTokenValuation = _getCKValuer(_ckToken).calculateCKTokenValuation(_ckToken, _reserveAsset);

        uint256 totalRedeemValueInPreciseUnits = _ckTokenQuantity.preciseMul(ckTokenValuation);
        // Get reserve asset decimals
        uint256 reserveAssetDecimals = ERC20(_reserveAsset).decimals();
        uint256 prePremiumReserveQuantity = totalRedeemValueInPreciseUnits.preciseMul(10 ** reserveAssetDecimals);

        uint256 premiumPercentage = _getRedeemPremium(_ckToken, _reserveAsset, _ckTokenQuantity);
        uint256 premiumQuantity = prePremiumReserveQuantity.preciseMulCeil(premiumPercentage);

        return prePremiumReserveQuantity.sub(premiumQuantity);
    }

    /**
     * The new position multiplier is calculated as follows:
     * inflationPercentage = (newSupply - oldSupply) / newSupply
     * newMultiplier = (1 - inflationPercentage) * positionMultiplier
     */    
    function _getIssuePositionMultiplier(
        ICKToken _ckToken,
        ActionInfo memory _issueInfo
    )
        internal
        view
        returns (uint256, int256)
    {
        // Calculate inflation and new position multiplier. Note: Round inflation up in order to round position multiplier down
        uint256 newTotalSupply = _issueInfo.ckTokenQuantity.add(_issueInfo.previousCKTokenSupply);
        int256 newPositionMultiplier = _ckToken.positionMultiplier()
            .mul(_issueInfo.previousCKTokenSupply.toInt256())
            .div(newTotalSupply.toInt256());

        return (newTotalSupply, newPositionMultiplier);
    }

    /**
     * Calculate deflation and new position multiplier. Note: Round deflation down in order to round position multiplier down
     * 
     * The new position multiplier is calculated as follows:
     * deflationPercentage = (oldSupply - newSupply) / newSupply
     * newMultiplier = (1 + deflationPercentage) * positionMultiplier
     */ 
    function _getRedeemPositionMultiplier(
        ICKToken _ckToken,
        uint256 _ckTokenQuantity,
        ActionInfo memory _redeemInfo
    )
        internal
        view
        returns (uint256, int256)
    {
        uint256 newTotalSupply = _redeemInfo.previousCKTokenSupply.sub(_ckTokenQuantity);
        int256 newPositionMultiplier = _ckToken.positionMultiplier()
            .mul(_redeemInfo.previousCKTokenSupply.toInt256())
            .div(newTotalSupply.toInt256());

        return (newTotalSupply, newPositionMultiplier);
    }

    /**
     * The new position reserve asset unit is calculated as follows:
     * totalReserve = (oldUnit * oldCKTokenSupply) + reserveQuantity
     * newUnit = totalReserve / newCKTokenSupply
     */ 
    function _getIssuePositionUnit(
        ICKToken _ckToken,
        address _reserveAsset,
        ActionInfo memory _issueInfo
    )
        internal
        view
        returns (uint256)
    {
        uint256 existingUnit = _ckToken.getDefaultPositionRealUnit(_reserveAsset).toUint256();
        uint256 totalReserve = existingUnit
            .preciseMul(_issueInfo.previousCKTokenSupply)
            .add(_issueInfo.netFlowQuantity);

        return totalReserve.preciseDiv(_issueInfo.newCKTokenSupply);
    }

    /**
     * The new position reserve asset unit is calculated as follows:
     * totalReserve = (oldUnit * oldCKTokenSupply) - reserveQuantityToSendOut
     * newUnit = totalReserve / newCKTokenSupply
     */ 
    function _getRedeemPositionUnit(
        ICKToken _ckToken,
        address _reserveAsset,
        ActionInfo memory _redeemInfo
    )
        internal
        view
        returns (uint256)
    {
        uint256 existingUnit = _ckToken.getDefaultPositionRealUnit(_reserveAsset).toUint256();
        uint256 totalExistingUnits = existingUnit.preciseMul(_redeemInfo.previousCKTokenSupply);

        uint256 outflow = _redeemInfo.netFlowQuantity.add(_redeemInfo.protocolFees).add(_redeemInfo.managerFee);

        // Require withdrawable quantity is greater than existing collateral
        require(totalExistingUnits >= outflow, "Must be greater than total available collateral");

        return totalExistingUnits.sub(outflow).preciseDiv(_redeemInfo.newCKTokenSupply);
    }

    /**
     * If a pre-issue hook has been configured, call the external-protocol contract. Pre-issue hook logic
     * can contain arbitrary logic including validations, external function calls, etc.
     */
    function _callPreIssueHooks(
        ICKToken _ckToken,
        address _reserveAsset,
        uint256 _reserveAssetQuantity,
        address _caller,
        address _to
    )
        internal
    {
        INAVIssuanceHook preIssueHook = navIssuanceSettings[_ckToken].managerIssuanceHook;
        if (address(preIssueHook) != address(0)) {
            preIssueHook.invokePreIssueHook(_ckToken, _reserveAsset, _reserveAssetQuantity, _caller, _to);
        }
    }

    /**
     * If a pre-redeem hook has been configured, call the external-protocol contract.
     */
    function _callPreRedeemHooks(ICKToken _ckToken, uint256 _ckQuantity, address _caller, address _to) internal {
        INAVIssuanceHook preRedeemHook = navIssuanceSettings[_ckToken].managerRedemptionHook;
        if (address(preRedeemHook) != address(0)) {
            preRedeemHook.invokePreRedeemHook(_ckToken, _ckQuantity, _caller, _to);
        }
    }

    /**
     * If a custom ck valuer has been configured, use it. Otherwise fetch the default one form the
     * controller.
     */
    function _getCKValuer(ICKToken _ckToken) internal view returns (ICKValuer) {
        ICKValuer customValuer =  navIssuanceSettings[_ckToken].ckValuer;
        return address(customValuer) == address(0) ? controller.getCKValuer() : customValuer;
    }
}
