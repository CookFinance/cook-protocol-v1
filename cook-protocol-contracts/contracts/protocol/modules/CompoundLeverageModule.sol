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

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import { Compound } from "../integration/lib/Compound.sol";
import { ICErc20 } from "../../interfaces/external/ICErc20.sol";
import { IComptroller } from "../../interfaces/external/IComptroller.sol";
import { IController } from "../../interfaces/IController.sol";
import { IDebtIssuanceModule } from "../../interfaces/IDebtIssuanceModule.sol";
import { IExchangeAdapter } from "../../interfaces/IExchangeAdapter.sol";
import { ICKToken } from "../../interfaces/ICKToken.sol";
import { ModuleBase } from "../lib/ModuleBase.sol";

/**
 * @title CompoundLeverageModule
 * @author Cook Finance
 *
 * Smart contract that enables leverage trading using Compound as the lending protocol. This module is paired with a debt issuance module that will call
 * functions on this module to keep interest accrual and liquidation state updated. This does not allow borrowing of assets from Compound alone. Each 
 * asset is leveraged when using this module.
 *
 * Note: Do not use this module in conjunction with other debt modules that allow Compound debt positions as it could lead to double counting of
 * debt when borrowed assets are the same.
 *
 */
contract CompoundLeverageModule is ModuleBase, ReentrancyGuard, Ownable {
    using Compound for ICKToken;

    /* ============ Structs ============ */

    struct EnabledAssets {
        address[] collateralCTokens;             // Array of enabled cToken collateral assets for a CKToken
        address[] borrowCTokens;                 // Array of enabled cToken borrow assets for a CKToken
        address[] borrowAssets;                  // Array of underlying borrow assets that map to the array of enabled cToken borrow assets
    }

    struct ActionInfo {
        ICKToken ckToken;                      // CKToken instance
        IExchangeAdapter exchangeAdapter;        // Exchange adapter instance
        uint256 ckTotalSupply;                  // Total supply of CKToken
        uint256 notionalSendQuantity;            // Total notional quantity sent to exchange
        uint256 minNotionalReceiveQuantity;      // Min total notional received from exchange
        ICErc20 collateralCTokenAsset;           // Address of cToken collateral asset
        ICErc20 borrowCTokenAsset;               // Address of cToken borrow asset
        uint256 preTradeReceiveTokenBalance;     // Balance of pre-trade receive token balance
    }

    /* ============ Events ============ */

    event LeverageIncreased(
        ICKToken indexed _ckToken,
        IERC20 indexed _borrowAsset,
        IERC20 indexed _collateralAsset,
        IExchangeAdapter _exchangeAdapter,
        uint256 _totalBorrowAmount,
        uint256 _totalReceiveAmount,
        uint256 _protocolFee
    );

    event LeverageDecreased(
        ICKToken indexed _ckToken,
        IERC20 indexed _collateralAsset,
        IERC20 indexed _repayAsset,
        IExchangeAdapter _exchangeAdapter,
        uint256 _totalRedeemAmount,
        uint256 _totalRepayAmount,
        uint256 _protocolFee
    );

    event CollateralAssetsUpdated(
        ICKToken indexed _ckToken,
        bool indexed _added,
        IERC20[] _assets
    );

    event BorrowAssetsUpdated(
        ICKToken indexed _ckToken,
        bool indexed _added,
        IERC20[] _assets
    );

    event CKTokenStatusUpdated(
        ICKToken indexed _ckToken,
        bool indexed _added
    );

    event AnyCKAllowedUpdated(
        bool indexed _anyCKAllowed    
    );

    /* ============ Constants ============ */

    // String identifying the DebtIssuanceModule in the IntegrationRegistry. Note: Governance must add DefaultIssuanceModule as
    // the string as the integration name
    string constant internal DEFAULT_ISSUANCE_MODULE_NAME = "DefaultIssuanceModule";

    // 0 index stores protocol fee % on the controller, charged in the trade function
    uint256 constant internal PROTOCOL_TRADE_FEE_INDEX = 0;

    /* ============ State Variables ============ */

    // Mapping of underlying to CToken. If ETH, then map WETH to cETH
    mapping(IERC20 => ICErc20) public underlyingToCToken;

    // Wrapped Ether address
    IERC20 internal weth;

    // Compound cEther address
    ICErc20 internal cEther;

    // Compound Comptroller contract
    IComptroller internal comptroller;

    // COMP token address
    IERC20 internal compToken;

    // Mapping to efficiently check if cToken market for collateral asset is valid in CKToken
    mapping(ICKToken => mapping(ICErc20 => bool)) public collateralCTokenEnabled;

    // Mapping to efficiently check if cToken market for borrow asset is valid in CKToken
    mapping(ICKToken => mapping(ICErc20 => bool)) public borrowCTokenEnabled;

    // Mapping of enabled collateral and borrow cTokens for syncing positions
    mapping(ICKToken => EnabledAssets) internal enabledAssets;

    // Mapping of CKToken to boolean indicating if CKToken is on allow list. Updateable by governance
    mapping(ICKToken => bool) public allowedCKTokens;

    // Boolean that returns if any CKToken can initialize this module. If false, then subject to allow list
    bool public anyCKAllowed;


    /* ============ Constructor ============ */

    /**
     * Instantiate addresses. Underlying to cToken mapping is created.
     * 
     * @param _controller               Address of controller contract
     * @param _compToken                Address of COMP token
     * @param _comptroller              Address of Compound Comptroller
     * @param _cEther                   Address of cEther contract
     * @param _weth                     Address of WETH contract
     */
    constructor(
        IController _controller,
        IERC20 _compToken,
        IComptroller _comptroller,
        ICErc20 _cEther,
        IERC20 _weth
    )
        public
        ModuleBase(_controller)
    {
        compToken = _compToken;
        comptroller = _comptroller;
        cEther = _cEther;
        weth = _weth;

        ICErc20[] memory cTokens = comptroller.getAllMarkets();

        for(uint256 i = 0; i < cTokens.length; i++) {
            ICErc20 cToken = cTokens[i];
            underlyingToCToken[
                cToken == _cEther ? _weth : IERC20(cTokens[i].underlying())
            ] = cToken;
        }
    }

    /* ============ External Functions ============ */

    /**
     * MANAGER ONLY: Increases leverage for a given collateral position using an enabled borrow asset that is enabled.
     * Performs a DEX trade, exchanging the borrow asset for collateral asset.
     *
     * @param _ckToken             Instance of the CKToken
     * @param _borrowAsset          Address of asset being borrowed for leverage
     * @param _collateralAsset      Address of collateral asset (underlying of cToken)
     * @param _borrowQuantity       Borrow quantity of asset in position units
     * @param _minReceiveQuantity   Min receive quantity of collateral asset to receive post-trade in position units
     * @param _tradeAdapterName     Name of trade adapter
     * @param _tradeData            Arbitrary data for trade
     */
    function lever(
        ICKToken _ckToken,
        IERC20 _borrowAsset,
        IERC20 _collateralAsset,
        uint256 _borrowQuantity,
        uint256 _minReceiveQuantity,
        string memory _tradeAdapterName,
        bytes memory _tradeData
    )
        external
        nonReentrant
        onlyManagerAndValidCK(_ckToken)
    {
        // For levering up, send quantity is derived from borrow asset and receive quantity is derived from 
        // collateral asset
        ActionInfo memory leverInfo = _createAndValidateActionInfo(
            _ckToken,
            _borrowAsset,
            _collateralAsset,
            _borrowQuantity,
            _minReceiveQuantity,
            _tradeAdapterName,
            true
        );

        _borrow(leverInfo.ckToken, leverInfo.borrowCTokenAsset, leverInfo.notionalSendQuantity);

        uint256 postTradeReceiveQuantity = _executeTrade(leverInfo, _borrowAsset, _collateralAsset, _tradeData);

        uint256 protocolFee = _accrueProtocolFee(_ckToken, _collateralAsset, postTradeReceiveQuantity);

        uint256 postTradeCollateralQuantity = postTradeReceiveQuantity.sub(protocolFee);

        _mintCToken(leverInfo.ckToken, leverInfo.collateralCTokenAsset, _collateralAsset, postTradeCollateralQuantity);

        _updateLeverPositions(leverInfo, _borrowAsset);

        emit LeverageIncreased(
            _ckToken,
            _borrowAsset,
            _collateralAsset,
            leverInfo.exchangeAdapter,
            leverInfo.notionalSendQuantity,
            postTradeCollateralQuantity,
            protocolFee
        );
    }

    /**
     * MANAGER ONLY: Decrease leverage for a given collateral position using an enabled borrow asset that is enabled
     *
     * @param _ckToken             Instance of the CKToken
     * @param _collateralAsset      Address of collateral asset (underlying of cToken)
     * @param _repayAsset           Address of asset being repaid
     * @param _redeemQuantity       Quantity of collateral asset to delever
     * @param _minRepayQuantity     Minimum amount of repay asset to receive post trade
     * @param _tradeAdapterName     Name of trade adapter
     * @param _tradeData            Arbitrary data for trade
     */
    function delever(
        ICKToken _ckToken,
        IERC20 _collateralAsset,
        IERC20 _repayAsset,
        uint256 _redeemQuantity,
        uint256 _minRepayQuantity,
        string memory _tradeAdapterName,
        bytes memory _tradeData
    )
        external
        nonReentrant
        onlyManagerAndValidCK(_ckToken)
    {
        // Note: for delevering, send quantity is derived from collateral asset and receive quantity is derived from 
        // repay asset
        ActionInfo memory deleverInfo = _createAndValidateActionInfo(
            _ckToken,
            _collateralAsset,
            _repayAsset,
            _redeemQuantity,
            _minRepayQuantity,
            _tradeAdapterName,
            false
        );

        _redeemUnderlying(deleverInfo.ckToken, deleverInfo.collateralCTokenAsset, deleverInfo.notionalSendQuantity);

        uint256 postTradeReceiveQuantity = _executeTrade(deleverInfo, _collateralAsset, _repayAsset, _tradeData);

        uint256 protocolFee = _accrueProtocolFee(_ckToken, _repayAsset, postTradeReceiveQuantity);

        uint256 repayQuantity = postTradeReceiveQuantity.sub(protocolFee);

        _repayBorrow(deleverInfo.ckToken, deleverInfo.borrowCTokenAsset, _repayAsset, repayQuantity);

        _updateLeverPositions(deleverInfo, _repayAsset);

        emit LeverageDecreased(
            _ckToken,
            _collateralAsset,
            _repayAsset,
            deleverInfo.exchangeAdapter,
            deleverInfo.notionalSendQuantity,
            repayQuantity,
            protocolFee
        );
    }

    /**
     * MANAGER ONLY: Pays down the borrow asset to 0 selling off a given collateral asset. Any extra received
     * borrow asset is updated as equity. No protocol fee is charged.
     *
     * @param _ckToken             Instance of the CKToken
     * @param _collateralAsset      Address of collateral asset (underlying of cToken)
     * @param _repayAsset           Address of asset being repaid (underlying asset e.g. DAI)
     * @param _redeemQuantity       Quantity of collateral asset to delever
     * @param _tradeAdapterName     Name of trade adapter
     * @param _tradeData            Arbitrary data for trade
     */
    function deleverToZeroBorrowBalance(
        ICKToken _ckToken,
        IERC20 _collateralAsset,
        IERC20 _repayAsset,
        uint256 _redeemQuantity,
        string memory _tradeAdapterName,
        bytes memory _tradeData
    )
        external
        nonReentrant
        onlyManagerAndValidCK(_ckToken)
    {
        uint256 notionalRedeemQuantity = _redeemQuantity.preciseMul(_ckToken.totalSupply());
        
        require(borrowCTokenEnabled[_ckToken][underlyingToCToken[_repayAsset]], "Borrow not enabled");
        uint256 notionalRepayQuantity = underlyingToCToken[_repayAsset].borrowBalanceCurrent(address(_ckToken));

        ActionInfo memory deleverInfo = _createAndValidateActionInfoNotional(
            _ckToken,
            _collateralAsset,
            _repayAsset,
            notionalRedeemQuantity,
            notionalRepayQuantity,
            _tradeAdapterName,
            false
        );

        _redeemUnderlying(deleverInfo.ckToken, deleverInfo.collateralCTokenAsset, deleverInfo.notionalSendQuantity);

        uint256 postTradeReceiveQuantity = _executeTrade(deleverInfo, _collateralAsset, _repayAsset, _tradeData);

        // We use notionalRepayQuantity vs. Compound's max value uint256(-1) to handle WETH properly
        _repayBorrow(deleverInfo.ckToken, deleverInfo.borrowCTokenAsset, _repayAsset, notionalRepayQuantity);

        // Update default position first to save gas on editing borrow position
        _ckToken.calculateAndEditDefaultPosition(
            address(_repayAsset),
            deleverInfo.ckTotalSupply,
            deleverInfo.preTradeReceiveTokenBalance
        );

        _updateLeverPositions(deleverInfo, _repayAsset);

        emit LeverageDecreased(
            _ckToken,
            _collateralAsset,
            _repayAsset,
            deleverInfo.exchangeAdapter,
            deleverInfo.notionalSendQuantity,
            notionalRepayQuantity,
            0 // No protocol fee
        );
    }

    /**
     * CALLABLE BY ANYBODY: Sync Set positions with enabled Compound collateral and borrow positions. For collateral 
     * assets, update cToken default position. For borrow assets, update external borrow position.
     * - Collateral assets may come out of sync when a position is liquidated
     * - Borrow assets may come out of sync when interest is accrued or position is liquidated and borrow is repaid
     *
     * @param _ckToken               Instance of the CKToken
     * @param _shouldAccrueInterest   Boolean indicating whether use current block interest rate value or stored value
     */
    function sync(ICKToken _ckToken, bool _shouldAccrueInterest) public nonReentrant onlyValidAndInitializedCK(_ckToken) {
        uint256 ckTotalSupply = _ckToken.totalSupply();

        // Only sync positions when CK supply is not 0. This preserves debt and collateral positions on issuance / redemption
        if (ckTotalSupply > 0) {
            // Loop through collateral assets
            address[] memory collateralCTokens = enabledAssets[_ckToken].collateralCTokens;
            for(uint256 i = 0; i < collateralCTokens.length; i++) {
                ICErc20 collateralCToken = ICErc20(collateralCTokens[i]);
                uint256 previousPositionUnit = _ckToken.getDefaultPositionRealUnit(address(collateralCToken)).toUint256();
                uint256 newPositionUnit = _getCollateralPosition(_ckToken, collateralCToken, ckTotalSupply);

                // Note: Accounts for if position does not exist on CKToken but is tracked in enabledAssets
                if (previousPositionUnit != newPositionUnit) {
                  _updateCollateralPosition(_ckToken, collateralCToken, newPositionUnit);
                }
            }

            // Loop through borrow assets
            address[] memory borrowCTokens = enabledAssets[_ckToken].borrowCTokens;
            address[] memory borrowAssets = enabledAssets[_ckToken].borrowAssets;
            for(uint256 i = 0; i < borrowCTokens.length; i++) {
                ICErc20 borrowCToken = ICErc20(borrowCTokens[i]);
                IERC20 borrowAsset = IERC20(borrowAssets[i]);

                int256 previousPositionUnit = _ckToken.getExternalPositionRealUnit(address(borrowAsset), address(this));

                int256 newPositionUnit = _getBorrowPosition(
                    _ckToken,
                    borrowCToken,
                    ckTotalSupply,
                    _shouldAccrueInterest
                );

                // Note: Accounts for if position does not exist on CKToken but is tracked in enabledAssets
                if (newPositionUnit != previousPositionUnit) {
                    _updateBorrowPosition(_ckToken, borrowAsset, newPositionUnit);
                }
            }
        }
    }


    /**
     * MANAGER ONLY: Initializes this module to the CKToken. Only callable by the CKToken's manager. Note: managers can enable
     * collateral and borrow assets that don't exist as positions on the CKToken
     *
     * @param _ckToken             Instance of the CKToken to initialize
     * @param _collateralAssets     Underlying tokens to be enabled as collateral in the CKToken
     * @param _borrowAssets         Underlying tokens to be enabled as borrow in the CKToken
     */
    function initialize(
        ICKToken _ckToken,
        IERC20[] memory _collateralAssets,
        IERC20[] memory _borrowAssets
    )
        external
        onlyCKManager(_ckToken, msg.sender)
        onlyValidAndPendingCK(_ckToken)
    {
        if (!anyCKAllowed) {
            require(allowedCKTokens[_ckToken], "Not allowed CKToken");
        }

        // Initialize module before trying register
        _ckToken.initializeModule();

        // Get debt issuance module registered to this module and require that it is initialized
        require(_ckToken.isInitializedModule(getAndValidateAdapter(DEFAULT_ISSUANCE_MODULE_NAME)), "Issuance not initialized");

        // Try if register exists on any of the modules including the debt issuance module
        address[] memory modules = _ckToken.getModules();
        for(uint256 i = 0; i < modules.length; i++) {
            try IDebtIssuanceModule(modules[i]).registerToIssuanceModule(_ckToken) {} catch {}
        }
        
        // Enable collateral and borrow assets on Compound
        addCollateralAssets(_ckToken, _collateralAssets);

        addBorrowAssets(_ckToken, _borrowAssets);
    }

    /**
     * MANAGER ONLY: Removes this module from the CKToken, via call by the CKToken. Compound Settings and manager enabled
     * cTokens are deleted. Markets are exited on Comptroller (only valid if borrow balances are zero)
     */
    function removeModule() external override onlyValidAndInitializedCK(ICKToken(msg.sender)) {
        ICKToken ckToken = ICKToken(msg.sender);

        // Sync Compound and CKToken positions prior to any removal action
        sync(ckToken, true);

        address[] memory borrowCTokens = enabledAssets[ckToken].borrowCTokens;
        for (uint256 i = 0; i < borrowCTokens.length; i++) {
            ICErc20 cToken = ICErc20(borrowCTokens[i]);

            // Will exit only if token isn't also being used as collateral
            if(!collateralCTokenEnabled[ckToken][cToken]) {
                // Note: if there is an existing borrow balance, will revert and market cannot be exited on Compound
                ckToken.invokeExitMarket(cToken, comptroller);
            }

            delete borrowCTokenEnabled[ckToken][cToken];
        }

        address[] memory collateralCTokens = enabledAssets[ckToken].collateralCTokens;
        for (uint256 i = 0; i < collateralCTokens.length; i++) {
            ICErc20 cToken = ICErc20(collateralCTokens[i]);

            ckToken.invokeExitMarket(cToken, comptroller);

            delete collateralCTokenEnabled[ckToken][cToken];
        }
        
        delete enabledAssets[ckToken];

        // Try if unregister exists on any of the modules
        address[] memory modules = ckToken.getModules();
        for(uint256 i = 0; i < modules.length; i++) {
            try IDebtIssuanceModule(modules[i]).unregisterFromIssuanceModule(ckToken) {} catch {}
        }
    }

    /**
     * MANAGER ONLY: Add registration of this module on debt issuance module for the CKToken. Note: if the debt issuance module is not added to CKToken
     * before this module is initialized, then this function needs to be called if the debt issuance module is later added and initialized to prevent state
     * inconsistencies
     *
     * @param _ckToken             Instance of the CKToken
     * @param _debtIssuanceModule   Debt issuance module address to register
     */
    function registerToModule(ICKToken _ckToken, IDebtIssuanceModule _debtIssuanceModule) external onlyManagerAndValidCK(_ckToken) {
        require(_ckToken.isInitializedModule(address(_debtIssuanceModule)), "Issuance not initialized");

        _debtIssuanceModule.registerToIssuanceModule(_ckToken);
    }

    /**
     * MANAGER ONLY: Add enabled collateral assets. Collateral assets are tracked for syncing positions and entered in Compound markets
     *
     * @param _ckToken             Instance of the CKToken
     * @param _newCollateralAssets  Addresses of new collateral underlying assets
     */
    function addCollateralAssets(ICKToken _ckToken, IERC20[] memory _newCollateralAssets) public onlyManagerAndValidCK(_ckToken) {
        for(uint256 i = 0; i < _newCollateralAssets.length; i++) {
            ICErc20 cToken = underlyingToCToken[_newCollateralAssets[i]];
            require(address(cToken) != address(0), "cToken must exist");
            require(!collateralCTokenEnabled[_ckToken][cToken], "Collateral enabled");

            // Note: Will only enter market if cToken is not enabled as a borrow asset as well
            if (!borrowCTokenEnabled[_ckToken][cToken]) {
                _ckToken.invokeEnterMarkets(cToken, comptroller);
            }

            collateralCTokenEnabled[_ckToken][cToken] = true;
            enabledAssets[_ckToken].collateralCTokens.push(address(cToken));
        }

        emit CollateralAssetsUpdated(_ckToken, true, _newCollateralAssets);
    }

    /**
     * MANAGER ONLY: Remove collateral asset. Collateral asset exited in Compound markets
     * If there is a borrow balance, collateral asset cannot be removed
     *
     * @param _ckToken             Instance of the CKToken
     * @param _collateralAssets     Addresses of collateral underlying assets to remove
     */
    function removeCollateralAssets(ICKToken _ckToken, IERC20[] memory _collateralAssets) external onlyManagerAndValidCK(_ckToken) {
        // Sync Compound and CKToken positions prior to any removal action
        sync(_ckToken, true);

        for(uint256 i = 0; i < _collateralAssets.length; i++) {
            ICErc20 cToken = underlyingToCToken[_collateralAssets[i]];
            require(collateralCTokenEnabled[_ckToken][cToken], "Collateral not enabled");
            
            // Note: Will only exit market if cToken is not enabled as a borrow asset as well
            // If there is an existing borrow balance, will revert and market cannot be exited on Compound
            if (!borrowCTokenEnabled[_ckToken][cToken]) {
                _ckToken.invokeExitMarket(cToken, comptroller);
            }

            delete collateralCTokenEnabled[_ckToken][cToken];
            enabledAssets[_ckToken].collateralCTokens.removeStorage(address(cToken));
        }

        emit CollateralAssetsUpdated(_ckToken, false, _collateralAssets);
    }

    /**
     * MANAGER ONLY: Add borrow asset. Borrow asset is tracked for syncing positions and entered in Compound markets
     *
     * @param _ckToken             Instance of the CKToken
     * @param _newBorrowAssets      Addresses of borrow underlying assets to add
     */
    function addBorrowAssets(ICKToken _ckToken, IERC20[] memory _newBorrowAssets) public onlyManagerAndValidCK(_ckToken) {
        for(uint256 i = 0; i < _newBorrowAssets.length; i++) {
            IERC20 newBorrowAsset = _newBorrowAssets[i];
            ICErc20 cToken = underlyingToCToken[newBorrowAsset];
            require(address(cToken) != address(0), "cToken must exist");
            require(!borrowCTokenEnabled[_ckToken][cToken], "Borrow enabled");

            // Note: Will only enter market if cToken is not enabled as a borrow asset as well
            if (!collateralCTokenEnabled[_ckToken][cToken]) {
                _ckToken.invokeEnterMarkets(cToken, comptroller);
            }

            borrowCTokenEnabled[_ckToken][cToken] = true;
            enabledAssets[_ckToken].borrowCTokens.push(address(cToken));
            enabledAssets[_ckToken].borrowAssets.push(address(newBorrowAsset));
        }

        emit BorrowAssetsUpdated(_ckToken, true, _newBorrowAssets);
    }

    /**
     * MANAGER ONLY: Remove borrow asset. Borrow asset is exited in Compound markets
     * If there is a borrow balance, borrow asset cannot be removed
     *
     * @param _ckToken             Instance of the CKToken
     * @param _borrowAssets         Addresses of borrow underlying assets to remove
     */
    function removeBorrowAssets(ICKToken _ckToken, IERC20[] memory _borrowAssets) external onlyManagerAndValidCK(_ckToken) {
        // Sync Compound and CKToken positions prior to any removal action
        sync(_ckToken, true);

        for(uint256 i = 0; i < _borrowAssets.length; i++) {
            ICErc20 cToken = underlyingToCToken[_borrowAssets[i]];
            require(borrowCTokenEnabled[_ckToken][cToken], "Borrow not enabled");
            
            // Note: Will only exit market if cToken is not enabled as a collateral asset as well
            // If there is an existing borrow balance, will revert and market cannot be exited on Compound
            if (!collateralCTokenEnabled[_ckToken][cToken]) {
                _ckToken.invokeExitMarket(cToken, comptroller);
            }

            delete borrowCTokenEnabled[_ckToken][cToken];
            enabledAssets[_ckToken].borrowCTokens.removeStorage(address(cToken));
            enabledAssets[_ckToken].borrowAssets.removeStorage(address(_borrowAssets[i]));
        }

        emit BorrowAssetsUpdated(_ckToken, false, _borrowAssets);
    }

    /**
     * GOVERNANCE ONLY: Add or remove allowed CKToken to initialize this module. Only callable by governance.
     *
     * @param _ckToken             Instance of the CKToken
     */
    function updateAllowedCKToken(ICKToken _ckToken, bool _status) external onlyOwner {
        allowedCKTokens[_ckToken] = _status;
        emit CKTokenStatusUpdated(_ckToken, _status);
    }

    /**
     * GOVERNANCE ONLY: Toggle whether any CKToken is allowed to initialize this module. Only callable by governance.
     *
     * @param _anyCKAllowed             Bool indicating whether allowedCKTokens is enabled
     */
    function updateAnyCKAllowed(bool _anyCKAllowed) external onlyOwner {
        anyCKAllowed = _anyCKAllowed;
        emit AnyCKAllowedUpdated(_anyCKAllowed);
    }

    /**
     * GOVERNANCE ONLY: Add Compound market to module with stored underlying to cToken mapping in case of market additions to Compound.
     *
     * IMPORTANT: Validations are skipped in order to get contract under bytecode limit 
     *
     * @param _cToken                   Address of cToken to add
     * @param _underlying               Address of underlying token that maps to cToken
     */
    function addCompoundMarket(ICErc20 _cToken, IERC20 _underlying) external onlyOwner {
        require(address(underlyingToCToken[_underlying]) == address(0), "Already added");
        underlyingToCToken[_underlying] = _cToken;
    }

    /**
     * GOVERNANCE ONLY: Remove Compound market on stored underlying to cToken mapping in case of market removals
     *
     * IMPORTANT: Validations are skipped in order to get contract under bytecode limit 
     *
     * @param _underlying               Address of underlying token to remove
     */
    function removeCompoundMarket(IERC20 _underlying) external onlyOwner {
        require(address(underlyingToCToken[_underlying]) != address(0), "Not added");
        delete underlyingToCToken[_underlying];
    }

    /**
     * MODULE ONLY: Hook called prior to issuance to sync positions on CKToken. Only callable by valid module.
     *
     * @param _ckToken             Instance of the CKToken
     */
    function moduleIssueHook(ICKToken _ckToken, uint256 /* _ckTokenQuantity */) external onlyModule(_ckToken) {
        sync(_ckToken, false);
    }

    /**
     * MODULE ONLY: Hook called prior to redemption to sync positions on CKToken. For redemption, always use current borrowed balance after interest accrual.
     * Only callable by valid module.
     *
     * @param _ckToken             Instance of the CKToken
     */
    function moduleRedeemHook(ICKToken _ckToken, uint256 /* _ckTokenQuantity */) external onlyModule(_ckToken) {
        sync(_ckToken, true);
    }

    /**
     * MODULE ONLY: Hook called prior to looping through each component on issuance. Invokes borrow in order for module to return debt to issuer. Only callable by valid module.
     *
     * @param _ckToken             Instance of the CKToken
     * @param _ckTokenQuantity     Quantity of CKToken
     * @param _component            Address of component
     */
    function componentIssueHook(ICKToken _ckToken, uint256 _ckTokenQuantity, IERC20 _component, bool /* _isEquity */) external onlyModule(_ckToken) {
        int256 componentDebt = _ckToken.getExternalPositionRealUnit(address(_component), address(this));

        require(componentDebt < 0, "Component must be negative");

        uint256 notionalDebt = componentDebt.mul(-1).toUint256().preciseMul(_ckTokenQuantity);

        _borrow(_ckToken, underlyingToCToken[_component], notionalDebt);
    }

    /**
     * MODULE ONLY: Hook called prior to looping through each component on redemption. Invokes repay after issuance module transfers debt from issuer. Only callable by valid module.
     *
     * @param _ckToken             Instance of the CKToken
     * @param _ckTokenQuantity     Quantity of CKToken
     * @param _component            Address of component
     */
    function componentRedeemHook(ICKToken _ckToken, uint256 _ckTokenQuantity, IERC20 _component, bool /* _isEquity */) external onlyModule(_ckToken) {
        int256 componentDebt = _ckToken.getExternalPositionRealUnit(address(_component), address(this));

        require(componentDebt < 0, "Component must be negative");

        uint256 notionalDebt = componentDebt.mul(-1).toUint256().preciseMulCeil(_ckTokenQuantity);

        _repayBorrow(_ckToken, underlyingToCToken[_component], _component, notionalDebt);
    }


    /* ============ External Getter Functions ============ */

    /**
     * Get enabled assets for CKToken. Returns an array of enabled cTokens that are collateral assets and an
     * array of underlying that are borrow assets.
     *
     * @return                    Collateral cToken assets that are enabled
     * @return                    Underlying borrowed assets that are enabled.
     */
    function getEnabledAssets(ICKToken _ckToken) external view returns(address[] memory, address[] memory) {
        return (
            enabledAssets[_ckToken].collateralCTokens,
            enabledAssets[_ckToken].borrowAssets
        );
    }

    /* ============ Internal Functions ============ */

    /**
     * Mints the specified cToken from the underlying of the specified notional quantity. If cEther, the WETH must be 
     * unwrapped as it only accepts the underlying ETH.
     */
    function _mintCToken(ICKToken _ckToken, ICErc20 _cToken, IERC20 _underlyingToken, uint256 _mintNotional) internal {
        if (_cToken == cEther) {
            _ckToken.invokeUnwrapWETH(address(weth), _mintNotional);

            _ckToken.invokeMintCEther(_cToken, _mintNotional);
        } else {
            _ckToken.invokeApprove(address(_underlyingToken), address(_cToken), _mintNotional);

            _ckToken.invokeMintCToken(_cToken, _mintNotional);
        }
    }

    /**
     * Invoke redeem from CKToken. If cEther, then also wrap ETH into WETH.
     */
    function _redeemUnderlying(ICKToken _ckToken, ICErc20 _cToken, uint256 _redeemNotional) internal {
        _ckToken.invokeRedeemUnderlying(_cToken, _redeemNotional);

        if (_cToken == cEther) {
            _ckToken.invokeWrapWETH(address(weth), _redeemNotional);
        }
    }

    /**
     * Invoke repay from CKToken. If cEther then unwrap WETH into ETH.
     */
    function _repayBorrow(ICKToken _ckToken, ICErc20 _cToken, IERC20 _underlyingToken, uint256 _repayNotional) internal {
        if (_cToken == cEther) {
            _ckToken.invokeUnwrapWETH(address(weth), _repayNotional);

            _ckToken.invokeRepayBorrowCEther(_cToken, _repayNotional);
        } else {
            // Approve to cToken
            _ckToken.invokeApprove(address(_underlyingToken), address(_cToken), _repayNotional);
            _ckToken.invokeRepayBorrowCToken(_cToken, _repayNotional);
        }
    }

    /**
     * Invoke the CKToken to interact with the specified cToken to borrow the cToken's underlying of the specified borrowQuantity.
     */
    function _borrow(ICKToken _ckToken, ICErc20 _cToken, uint256 _notionalBorrowQuantity) internal {
        _ckToken.invokeBorrow(_cToken, _notionalBorrowQuantity);
        if (_cToken == cEther) {
            _ckToken.invokeWrapWETH(address(weth), _notionalBorrowQuantity);
        }
    }

    /**
     * Invokes approvals, gets trade call data from exchange adapter and invokes trade from CKToken
     *
     * @return receiveTokenQuantity The quantity of tokens received post-trade
     */
    function _executeTrade(
        ActionInfo memory _actionInfo,
        IERC20 _sendToken,
        IERC20 _receiveToken,
        bytes memory _data
    )
        internal
        returns (uint256)
    {
         ICKToken ckToken = _actionInfo.ckToken;
         uint256 notionalSendQuantity = _actionInfo.notionalSendQuantity;

         ckToken.invokeApprove(
            address(_sendToken),
            _actionInfo.exchangeAdapter.getSpender(),
            notionalSendQuantity
        );

        (
            address targetExchange,
            uint256 callValue,
            bytes memory methodData
        ) = _actionInfo.exchangeAdapter.getTradeCalldata(
            address(_sendToken),
            address(_receiveToken),
            address(ckToken),
            notionalSendQuantity,
            _actionInfo.minNotionalReceiveQuantity,
            _data
        );

        ckToken.invoke(targetExchange, callValue, methodData);

        uint256 receiveTokenQuantity = _receiveToken.balanceOf(address(ckToken)).sub(_actionInfo.preTradeReceiveTokenBalance);
        require(
            receiveTokenQuantity >= _actionInfo.minNotionalReceiveQuantity,
            "Slippage too high"
        );

        return receiveTokenQuantity;
    }

    /**
     * Calculates protocol fee on module and pays protocol fee from CKToken
     */
    function _accrueProtocolFee(ICKToken _ckToken, IERC20 _receiveToken, uint256 _exchangedQuantity) internal returns(uint256) {
        uint256 protocolFeeTotal = getModuleFee(PROTOCOL_TRADE_FEE_INDEX, _exchangedQuantity);
        
        payProtocolFeeFromCKToken(_ckToken, address(_receiveToken), protocolFeeTotal);

        return protocolFeeTotal;
    }

    /**
     * Updates the collateral (cToken held) and borrow position (underlying owed on Compound)
     */
    function _updateLeverPositions(ActionInfo memory actionInfo, IERC20 _borrowAsset) internal {
        _updateCollateralPosition(
            actionInfo.ckToken,
            actionInfo.collateralCTokenAsset,
            _getCollateralPosition(
                actionInfo.ckToken,
                actionInfo.collateralCTokenAsset,
                actionInfo.ckTotalSupply
            )
        );

        _updateBorrowPosition(
            actionInfo.ckToken,
            _borrowAsset,
            _getBorrowPosition(
                actionInfo.ckToken,
                actionInfo.borrowCTokenAsset,
                actionInfo.ckTotalSupply,
                false // Do not accrue interest
            )
        );
    }

    function _updateCollateralPosition(ICKToken _ckToken, ICErc20 _cToken, uint256 _newPositionUnit) internal {
        _ckToken.editDefaultPosition(address(_cToken), _newPositionUnit);
    }

    function _updateBorrowPosition(ICKToken _ckToken, IERC20 _underlyingToken, int256 _newPositionUnit) internal {
        _ckToken.editExternalPosition(address(_underlyingToken), address(this), _newPositionUnit, "");
    }

    /**
     * Construct the ActionInfo struct for lever and delever
     */
    function _createAndValidateActionInfo(
        ICKToken _ckToken,
        IERC20 _sendToken,
        IERC20 _receiveToken,
        uint256 _sendQuantityUnits,
        uint256 _minReceiveQuantityUnits,
        string memory _tradeAdapterName,
        bool _isLever
    )
        internal
        view
        returns(ActionInfo memory)
    {
        uint256 totalSupply = _ckToken.totalSupply();

        return _createAndValidateActionInfoNotional(
            _ckToken,
            _sendToken,
            _receiveToken,
            _sendQuantityUnits.preciseMul(totalSupply),
            _minReceiveQuantityUnits.preciseMul(totalSupply),
            _tradeAdapterName,
            _isLever
        );
    }

    /**
     * Construct the ActionInfo struct for lever and delever accepting notional units
     */
    function _createAndValidateActionInfoNotional(
        ICKToken _ckToken,
        IERC20 _sendToken,
        IERC20 _receiveToken,
        uint256 _notionalSendQuantity,
        uint256 _minNotionalReceiveQuantity,
        string memory _tradeAdapterName,
        bool _isLever
    )
        internal
        view
        returns(ActionInfo memory)
    {
        uint256 totalSupply = _ckToken.totalSupply();
        ActionInfo memory actionInfo = ActionInfo ({
            exchangeAdapter: IExchangeAdapter(getAndValidateAdapter(_tradeAdapterName)),
            ckToken: _ckToken,
            collateralCTokenAsset: _isLever ? underlyingToCToken[_receiveToken] : underlyingToCToken[_sendToken],
            borrowCTokenAsset: _isLever ? underlyingToCToken[_sendToken] : underlyingToCToken[_receiveToken],
            ckTotalSupply: totalSupply,
            notionalSendQuantity: _notionalSendQuantity,
            minNotionalReceiveQuantity: _minNotionalReceiveQuantity,
            preTradeReceiveTokenBalance: IERC20(_receiveToken).balanceOf(address(_ckToken))
        });

        _validateCommon(actionInfo);

        return actionInfo;
    }



    function _validateCommon(ActionInfo memory _actionInfo) internal view {
        require(collateralCTokenEnabled[_actionInfo.ckToken][_actionInfo.collateralCTokenAsset], "Collateral not enabled");
        require(borrowCTokenEnabled[_actionInfo.ckToken][_actionInfo.borrowCTokenAsset], "Borrow not enabled");
        require(_actionInfo.collateralCTokenAsset != _actionInfo.borrowCTokenAsset, "Must be different");
        require(_actionInfo.notionalSendQuantity > 0, "Quantity is 0");
    }

    function _getCollateralPosition(ICKToken _ckToken, ICErc20 _cToken, uint256 _ckTotalSupply) internal view returns (uint256) {
        uint256 collateralNotionalBalance = _cToken.balanceOf(address(_ckToken));
        return collateralNotionalBalance.preciseDiv(_ckTotalSupply);
    }

    /**
     * Get borrow position. If should accrue interest is true, then accrue interest on Compound and use current borrow balance, else use the stored value to save gas.
     * Use the current value for debt redemption, when we need to calculate the exact units of debt that needs to be repaid.
     */
    function _getBorrowPosition(ICKToken _ckToken, ICErc20 _cToken, uint256 _ckTotalSupply, bool _shouldAccrueInterest) internal returns (int256) {
        uint256 borrowNotionalBalance = _shouldAccrueInterest ? _cToken.borrowBalanceCurrent(address(_ckToken)) : _cToken.borrowBalanceStored(address(_ckToken));
        // Round negative away from 0
        int256 borrowPositionUnit = borrowNotionalBalance.preciseDivCeil(_ckTotalSupply).toInt256().mul(-1);

        return borrowPositionUnit;
    }
}