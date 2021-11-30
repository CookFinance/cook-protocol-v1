/*
    Copyright 2021 Cook Finance

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

import { AaveV2 } from "../integration/lib/AaveV2.sol";
import { IAToken } from "../../interfaces/external/aave-v2/IAToken.sol";
import { IController } from "../../interfaces/IController.sol";
import { IDebtIssuanceModule } from "../../interfaces/IDebtIssuanceModule.sol";
import { IExchangeAdapter } from "../../interfaces/IExchangeAdapter.sol";
import { ILendingPool } from "../../interfaces/external/aave-v2/ILendingPool.sol";
import { ILendingPoolAddressesProvider } from "../../interfaces/external/aave-v2/ILendingPoolAddressesProvider.sol";
import { IModuleIssuanceHook } from "../../interfaces/IModuleIssuanceHook.sol";
import { IProtocolDataProvider } from "../../interfaces/external/aave-v2/IProtocolDataProvider.sol";
import { ICKToken } from "../../interfaces/ICKToken.sol";
import { IVariableDebtToken } from "../../interfaces/external/aave-v2/IVariableDebtToken.sol";
import { ModuleBase } from "../lib/ModuleBase.sol";

/**
 * @title AaveLeverageModule
 * @author Cook Finance
 * @notice Smart contract that enables leverage trading using Aave as the lending protocol.
 * @dev Do not use this module in conjunction with other debt modules that allow Aave debt positions as it could lead to double counting of
 * debt when borrowed assets are the same.
 */
contract AaveLeverageModule is ModuleBase, ReentrancyGuard, Ownable, IModuleIssuanceHook {
    using AaveV2 for ICKToken;

    /* ============ Structs ============ */

    struct EnabledAssets {
        address[] collateralAssets;             // Array of enabled underlying collateral assets for a CKToken
        address[] borrowAssets;                 // Array of enabled underlying borrow assets for a CKToken
    }

    struct ActionInfo {
        ICKToken ckToken;                        // CKToken instance
        ILendingPool lendingPool;                // Lending pool instance, we grab this everytime since it's best practice not to store
        IExchangeAdapter exchangeAdapter;        // Exchange adapter instance
        uint256 ckTotalSupply;                   // Total supply of CKToken
        uint256 notionalSendQuantity;            // Total notional quantity sent to exchange
        uint256 minNotionalReceiveQuantity;      // Min total notional received from exchange
        IERC20 collateralAsset;                  // Address of collateral asset
        IERC20 borrowAsset;                      // Address of borrow asset
        uint256 preTradeReceiveTokenBalance;     // Balance of pre-trade receive token balance
    }

    struct ReserveTokens {
        IAToken aToken;                         // Reserve's aToken instance
        IVariableDebtToken variableDebtToken;   // Reserve's variable debt token instance
    }

    /* ============ Events ============ */

    /**
     * @dev Emitted on lever()
     * @param _ckToken              Instance of the CKToken being levered
     * @param _borrowAsset          Asset being borrowed for leverage
     * @param _collateralAsset      Collateral asset being levered
     * @param _exchangeAdapter      Exchange adapter used for trading
     * @param _totalBorrowAmount    Total amount of `_borrowAsset` borrowed
     * @param _totalReceiveAmount   Total amount of `_collateralAsset` received by selling `_borrowAsset`
     * @param _protocolFee          Protocol fee charged
     */
    event LeverageIncreased(
        ICKToken indexed _ckToken,
        IERC20 indexed _borrowAsset,
        IERC20 indexed _collateralAsset,
        IExchangeAdapter _exchangeAdapter,
        uint256 _totalBorrowAmount,
        uint256 _totalReceiveAmount,
        uint256 _protocolFee
    );

    /**
     * @dev Emitted on delever() and deleverToZeroBorrowBalance()
     * @param _ckToken              Instance of the CKToken being delevered
     * @param _collateralAsset      Asset sold to decrease leverage
     * @param _repayAsset           Asset being bought to repay to Aave
     * @param _exchangeAdapter      Exchange adapter used for trading
     * @param _totalRedeemAmount    Total amount of `_collateralAsset` being sold
     * @param _totalRepayAmount     Total amount of `_repayAsset` being repaid
     * @param _protocolFee          Protocol fee charged
     */
    event LeverageDecreased(
        ICKToken indexed _ckToken,
        IERC20 indexed _collateralAsset,
        IERC20 indexed _repayAsset,
        IExchangeAdapter _exchangeAdapter,
        uint256 _totalRedeemAmount,
        uint256 _totalRepayAmount,
        uint256 _protocolFee
    );

    /**
     * @dev Emitted on addCollateralAssets() and removeCollateralAssets()
     * @param _ckToken  Instance of CKToken whose collateral assets is updated
     * @param _added    true if assets are added false if removed
     * @param _assets   Array of collateral assets being added/removed
     */
    event CollateralAssetsUpdated(
        ICKToken indexed _ckToken,
        bool indexed _added,
        IERC20[] _assets
    );

    /**
     * @dev Emitted on addBorrowAssets() and removeBorrowAssets()
     * @param _ckToken  Instance of CKToken whose borrow assets is updated
     * @param _added    true if assets are added false if removed
     * @param _assets   Array of borrow assets being added/removed
     */
    event BorrowAssetsUpdated(
        ICKToken indexed _ckToken,
        bool indexed _added,
        IERC20[] _assets
    );
    
    /**
     * @dev Emitted when `underlyingToReserveTokensMappings` is updated
     * @param _underlying           Address of the underlying asset
     * @param _aToken               Updated aave reserve aToken
     * @param _variableDebtToken    Updated aave reserve variable debt token 
     */
    event ReserveTokensUpdated(
        IERC20 indexed _underlying,
        IAToken indexed _aToken,
        IVariableDebtToken indexed _variableDebtToken
    );
    
    /**
     * @dev Emitted on updateAllowedCKToken()
     * @param _ckToken  CKToken being whose allowance to initialize this module is being updated
     * @param _added    true if added false if removed
     */
    event CKTokenStatusUpdated(
        ICKToken indexed _ckToken,
        bool indexed _added
    );

    /**
     * @dev Emitted on updateAnyCKAllowed()
     * @param _anyCKAllowed    true if any CK is allowed to initialize this module, false otherwise
     */
    event AnyCKAllowedUpdated(
        bool indexed _anyCKAllowed    
    );

    /* ============ Constants ============ */

    // This module only supports borrowing in variable rate mode from Aave which is represented by 2
    uint256 constant internal BORROW_RATE_MODE = 2;
    
    // String identifying the DebtIssuanceModule in the IntegrationRegistry. Note: Governance must add DefaultIssuanceModule as
    // the string as the integration name
    string constant internal DEFAULT_ISSUANCE_MODULE_NAME = "DefaultIssuanceModule";

    // 0 index stores protocol fee % on the controller, charged in the _executeTrade function
    uint256 constant internal PROTOCOL_TRADE_FEE_INDEX = 0;

    /* ============ State Variables ============ */

    // Mapping to efficiently fetch reserve token addresses. Tracking Aave reserve token addresses and updating them 
    // upon requirement is more efficient than fetching them each time from Aave.
    // Note: For an underlying asset to be enabled as collateral/borrow asset on CKToken, it must be added to this mapping first.
    mapping(IERC20 => ReserveTokens) public underlyingToReserveTokens;

    // Used to fetch reserves and user data from AaveV2
    IProtocolDataProvider public immutable protocolDataProvider;
    
    // Used to fetch lendingPool address. This contract is immutable and its address will never change.
    ILendingPoolAddressesProvider public immutable lendingPoolAddressesProvider;
    
    // Mapping to efficiently check if collateral asset is enabled in CKToken
    mapping(ICKToken => mapping(IERC20 => bool)) public collateralAssetEnabled;
    
    // Mapping to efficiently check if a borrow asset is enabled in CKToken
    mapping(ICKToken => mapping(IERC20 => bool)) public borrowAssetEnabled;
    
    // Internal mapping of enabled collateral and borrow tokens for syncing positions
    mapping(ICKToken => EnabledAssets) internal enabledAssets;

    // Mapping of CKToken to boolean indicating if CKToken is on allow list. Updateable by governance
    mapping(ICKToken => bool) public allowedCKTokens;

    // Boolean that returns if any CKToken can initialize this module. If false, then subject to allow list. Updateable by governance.
    bool public anyCKAllowed;
    
    /* ============ Constructor ============ */

    /**
     * @dev Instantiate addresses. Underlying to reserve tokens mapping is created.
     * @param _controller                       Address of controller contract
     * @param _lendingPoolAddressesProvider     Address of Aave LendingPoolAddressProvider
     */
    constructor(
        IController _controller,
        ILendingPoolAddressesProvider _lendingPoolAddressesProvider
    )
        public
        ModuleBase(_controller)
    {
        lendingPoolAddressesProvider = _lendingPoolAddressesProvider;
        IProtocolDataProvider _protocolDataProvider = IProtocolDataProvider(
            // Use the raw input vs bytes32() conversion. This is to ensure the input is an uint and not a string.
            _lendingPoolAddressesProvider.getAddress(0x0100000000000000000000000000000000000000000000000000000000000000)
        );
        protocolDataProvider = _protocolDataProvider;
        
        IProtocolDataProvider.TokenData[] memory reserveTokens = _protocolDataProvider.getAllReservesTokens();
        for(uint256 i = 0; i < reserveTokens.length; i++) {
            (address aToken, , address variableDebtToken) = _protocolDataProvider.getReserveTokensAddresses(reserveTokens[i].tokenAddress);
            underlyingToReserveTokens[IERC20(reserveTokens[i].tokenAddress)] = ReserveTokens(IAToken(aToken), IVariableDebtToken(variableDebtToken));
        }
    }
    
    /* ============ External Functions ============ */
    
    /**
     * @dev MANAGER ONLY: Increases leverage for a given collateral position using an enabled borrow asset.
     * Borrows _borrowAsset from Aave. Performs a DEX trade, exchanging the _borrowAsset for _collateralAsset.
     * Deposits _collateralAsset to Aave and mints corresponding aToken.
     * Note: Both collateral and borrow assets need to be enabled, and they must not be the same asset.
     * @param _ckToken                      Instance of the CKToken
     * @param _borrowAsset                  Address of underlying asset being borrowed for leverage
     * @param _collateralAsset              Address of underlying collateral asset
     * @param _borrowQuantityUnits          Borrow quantity of asset in position units
     * @param _minReceiveQuantityUnits      Min receive quantity of collateral asset to receive post-trade in position units
     * @param _tradeAdapterName             Name of trade adapter
     * @param _tradeData                    Arbitrary data for trade
     */
    function lever(
        ICKToken _ckToken,
        IERC20 _borrowAsset,
        IERC20 _collateralAsset,
        uint256 _borrowQuantityUnits,
        uint256 _minReceiveQuantityUnits,
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
            _borrowQuantityUnits,
            _minReceiveQuantityUnits,
            _tradeAdapterName,
            true
        );

        _borrow(leverInfo.ckToken, leverInfo.lendingPool, leverInfo.borrowAsset, leverInfo.notionalSendQuantity);

        uint256 postTradeReceiveQuantity = _executeTrade(leverInfo, _borrowAsset, _collateralAsset, _tradeData);

        uint256 protocolFee = _accrueProtocolFee(_ckToken, _collateralAsset, postTradeReceiveQuantity);

        uint256 postTradeCollateralQuantity = postTradeReceiveQuantity.sub(protocolFee);

        _deposit(leverInfo.ckToken, leverInfo.lendingPool, _collateralAsset, postTradeCollateralQuantity);

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
     * @dev MANAGER ONLY: Decrease leverage for a given collateral position using an enabled borrow asset.
     * Withdraws _collateralAsset from Aave. Performs a DEX trade, exchanging the _collateralAsset for _repayAsset.
     * Repays _repayAsset to Aave and burns corresponding debt tokens.
     * Note: Both collateral and borrow assets need to be enabled, and they must not be the same asset.
     * @param _ckToken                  Instance of the CKToken
     * @param _collateralAsset          Address of underlying collateral asset being withdrawn
     * @param _repayAsset               Address of underlying borrowed asset being repaid
     * @param _redeemQuantityUnits      Quantity of collateral asset to delever in position units
     * @param _minRepayQuantityUnits    Minimum amount of repay asset to receive post trade in position units
     * @param _tradeAdapterName         Name of trade adapter
     * @param _tradeData                Arbitrary data for trade
     */
    function delever(
        ICKToken _ckToken,
        IERC20 _collateralAsset,
        IERC20 _repayAsset,
        uint256 _redeemQuantityUnits,
        uint256 _minRepayQuantityUnits,
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
            _redeemQuantityUnits,
            _minRepayQuantityUnits,
            _tradeAdapterName,
            false
        );

        _withdraw(deleverInfo.ckToken, deleverInfo.lendingPool, _collateralAsset, deleverInfo.notionalSendQuantity);

        uint256 postTradeReceiveQuantity = _executeTrade(deleverInfo, _collateralAsset, _repayAsset, _tradeData);

        uint256 protocolFee = _accrueProtocolFee(_ckToken, _repayAsset, postTradeReceiveQuantity);

        uint256 repayQuantity = postTradeReceiveQuantity.sub(protocolFee);

        _repayBorrow(deleverInfo.ckToken, deleverInfo.lendingPool, _repayAsset, repayQuantity);

        _updateDeleverPositions(deleverInfo, _repayAsset);

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

    /** @dev MANAGER ONLY: Pays down the borrow asset to 0 selling off a given amount of collateral asset. 
     * Withdraws _collateralAsset from Aave. Performs a DEX trade, exchanging the _collateralAsset for _repayAsset. 
     * Minimum receive amount for the DEX trade is set to the current variable debt balance of the borrow asset. 
     * Repays received _repayAsset to Aave which burns corresponding debt tokens. Any extra received borrow asset is .
     * updated as equity. No protocol fee is charged.
     * Note: Both collateral and borrow assets need to be enabled, and they must not be the same asset.
     * The function reverts if not enough collateral asset is redeemed to buy the required minimum amount of _repayAsset.
     * @param _ckToken              Instance of the CKToken
     * @param _collateralAsset      Address of underlying collateral asset being redeemed
     * @param _repayAsset           Address of underlying asset being repaid
     * @param _redeemQuantityUnits  Quantity of collateral asset to delever in position units
     * @param _tradeAdapterName     Name of trade adapter
     * @param _tradeData            Arbitrary data for trade     
     * @return uint256              Notional repay quantity
     */
    function deleverToZeroBorrowBalance(
        ICKToken _ckToken,
        IERC20 _collateralAsset,
        IERC20 _repayAsset,
        uint256 _redeemQuantityUnits,
        string memory _tradeAdapterName,
        bytes memory _tradeData
    )
        external
        nonReentrant
        onlyManagerAndValidCK(_ckToken)
        returns (uint256)
    {
        uint256 ckTotalSupply = _ckToken.totalSupply();
        uint256 notionalRedeemQuantity = _redeemQuantityUnits.preciseMul(ckTotalSupply);
        
        require(borrowAssetEnabled[_ckToken][_repayAsset], "Borrow not enabled");
        uint256 notionalRepayQuantity = underlyingToReserveTokens[_repayAsset].variableDebtToken.balanceOf(address(_ckToken));
        require(notionalRepayQuantity > 0, "Borrow balance is zero");

        ActionInfo memory deleverInfo = _createAndValidateActionInfoNotional(
            _ckToken,
            _collateralAsset,
            _repayAsset,
            notionalRedeemQuantity,
            notionalRepayQuantity,
            _tradeAdapterName,
            false,
            ckTotalSupply
        );

        _withdraw(deleverInfo.ckToken, deleverInfo.lendingPool, _collateralAsset, deleverInfo.notionalSendQuantity);

        _executeTrade(deleverInfo, _collateralAsset, _repayAsset, _tradeData);

        _repayBorrow(deleverInfo.ckToken, deleverInfo.lendingPool, _repayAsset, notionalRepayQuantity);

        _updateDeleverPositions(deleverInfo, _repayAsset);

        emit LeverageDecreased(
            _ckToken,
            _collateralAsset,
            _repayAsset,
            deleverInfo.exchangeAdapter,
            deleverInfo.notionalSendQuantity,
            notionalRepayQuantity,
            0   // No protocol fee
        );

        return notionalRepayQuantity;
    }

    /**
     * @dev CALLABLE BY ANYBODY: Sync CK positions with ALL enabled Aave collateral and borrow positions. 
     * For collateral assets, update aToken default position. For borrow assets, update external borrow position.
     * - Collateral assets may come out of sync when interest is accrued or a position is liquidated
     * - Borrow assets may come out of sync when interest is accrued or position is liquidated and borrow is repaid
     * Note: In Aave, both collateral and borrow interest is accrued in each block by increasing the balance of
     * aTokens and debtTokens for each user, and 1 aToken = 1 variableDebtToken = 1 underlying.
     * @param _ckToken                Instance of the CKToken
     */
    function sync(ICKToken _ckToken) public nonReentrant onlyValidAndInitializedCK(_ckToken) {
        uint256 ckTotalSupply = _ckToken.totalSupply();

        // Only sync positions when CK supply is not 0. Without this check, if sync is called by someone before the 
        // first issuance, then editDefaultPosition would remove the default positions from the CKToken
        if (ckTotalSupply > 0) {
            address[] memory collateralAssets = enabledAssets[_ckToken].collateralAssets;
            for(uint256 i = 0; i < collateralAssets.length; i++) {
                IAToken aToken = underlyingToReserveTokens[IERC20(collateralAssets[i])].aToken;
                
                uint256 previousPositionUnit = _ckToken.getDefaultPositionRealUnit(address(aToken)).toUint256();
                uint256 newPositionUnit = _getCollateralPosition(_ckToken, aToken, ckTotalSupply);

                // Note: Accounts for if position does not exist on CKToken but is tracked in enabledAssets
                if (previousPositionUnit != newPositionUnit) {
                  _updateCollateralPosition(_ckToken, aToken, newPositionUnit);
                }
            }
        
            address[] memory borrowAssets = enabledAssets[_ckToken].borrowAssets;
            for(uint256 i = 0; i < borrowAssets.length; i++) {
                IERC20 borrowAsset = IERC20(borrowAssets[i]);

                int256 previousPositionUnit = _ckToken.getExternalPositionRealUnit(address(borrowAsset), address(this));
                int256 newPositionUnit = _getBorrowPosition(_ckToken, borrowAsset, ckTotalSupply);

                // Note: Accounts for if position does not exist on CKToken but is tracked in enabledAssets
                if (newPositionUnit != previousPositionUnit) {
                    _updateBorrowPosition(_ckToken, borrowAsset, newPositionUnit);
                }
            }
        }
    }

    /**
     * @dev MANAGER ONLY: Initializes this module to the CKToken. Either the CKToken needs to be on the allowed list
     * or anyCKAllowed needs to be true. Only callable by the CKToken's manager.
     * Note: Managers can enable collateral and borrow assets that don't exist as positions on the CKToken
     * @param _ckToken              Instance of the CKToken to initialize
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
        
        // _collateralAssets and _borrowAssets arrays are validated in their respective internal functions
        _addCollateralAssets(_ckToken, _collateralAssets);
        _addBorrowAssets(_ckToken, _borrowAssets);
    }

    /**
     * @dev MANAGER ONLY: Removes this module from the CKToken, via call by the CKToken. Any deposited collateral assets
     * are disabled to be used as collateral on Aave. Aave Settings and manager enabled assets state is deleted.      
     * Note: Function will revert is there is any debt remaining on Aave
     */
    function removeModule() external override onlyValidAndInitializedCK(ICKToken(msg.sender)) {
        ICKToken ckToken = ICKToken(msg.sender);

        // Sync Aave and CKToken positions prior to any removal action
        sync(ckToken);

        address[] memory borrowAssets = enabledAssets[ckToken].borrowAssets;
        for(uint256 i = 0; i < borrowAssets.length; i++) {
            IERC20 borrowAsset = IERC20(borrowAssets[i]);
            require(underlyingToReserveTokens[borrowAsset].variableDebtToken.balanceOf(address(ckToken)) == 0, "Variable debt remaining");
    
            delete borrowAssetEnabled[ckToken][borrowAsset];
        }

        address[] memory collateralAssets = enabledAssets[ckToken].collateralAssets;
        for(uint256 i = 0; i < collateralAssets.length; i++) {
            IERC20 collateralAsset = IERC20(collateralAssets[i]);
            _updateUseReserveAsCollateral(ckToken, collateralAsset, false);

            delete collateralAssetEnabled[ckToken][collateralAsset];
        }
        
        delete enabledAssets[ckToken];

        // Try if unregister exists on any of the modules
        address[] memory modules = ckToken.getModules();
        for(uint256 i = 0; i < modules.length; i++) {
            try IDebtIssuanceModule(modules[i]).unregisterFromIssuanceModule(ckToken) {} catch {}
        }
    }

    /**
     * @dev MANAGER ONLY: Add registration of this module on the debt issuance module for the CKToken. 
     * Note: if the debt issuance module is not added to CKToken before this module is initialized, then this function
     * needs to be called if the debt issuance module is later added and initialized to prevent state inconsistencies
     * @param _ckToken              Instance of the CKToken
     * @param _debtIssuanceModule   Debt issuance module address to register
     */
    function registerToModule(ICKToken _ckToken, IDebtIssuanceModule _debtIssuanceModule) external onlyManagerAndValidCK(_ckToken) {
        require(_ckToken.isInitializedModule(address(_debtIssuanceModule)), "Issuance not initialized");

        _debtIssuanceModule.registerToIssuanceModule(_ckToken);
    }

    /**
     * @dev CALLABLE BY ANYBODY: Updates `underlyingToReserveTokens` mappings. Reverts if mapping already exists
     * or the passed _underlying asset does not have a valid reserve on Aave.
     * Note: Call this function when Aave adds a new reserve.
     * @param _underlying               Address of underlying asset
     */
    function addUnderlyingToReserveTokensMapping(IERC20 _underlying) external {
        require(address(underlyingToReserveTokens[_underlying].aToken) == address(0), "Mapping already exists");

        // An active reserve is an alias for a valid reserve on Aave.
        (,,,,,,,, bool isActive,) = protocolDataProvider.getReserveConfigurationData(address(_underlying));
        require(isActive, "Invalid aave reserve");
        
        _addUnderlyingToReserveTokensMapping(_underlying);
    }

    /**
     * @dev MANAGER ONLY: Add collateral assets. aTokens corresponding to collateral assets are tracked for syncing positions.
     * Note: Reverts with "Collateral already enabled" if there are duplicate assets in the passed _newCollateralAssets array.
     * 
     * NOTE: ALL ADDED COLLATERAL ASSETS CAN BE ADDED AS A POSITION ON THE CK TOKEN WITHOUT MANAGER'S EXPLICIT PERMISSION.
     * UNWANTED EXTRA POSITIONS CAN BREAK EXTERNAL LOGIC, INCREASE COST OF MINT/REDEEM OF CK TOKEN, AMONG OTHER POTENTIAL UNINTENDED CONSEQUENCES.
     * SO, PLEASE ADD ONLY THOSE COLLATERAL ASSETS WHOSE CORRESPONDING aTOKENS ARE NEEDED AS DEFAULT POSITIONS ON THE CK TOKEN.
     *
     * @param _ckToken              Instance of the CKToken
     * @param _newCollateralAssets  Addresses of new collateral underlying assets
     */
    function addCollateralAssets(ICKToken _ckToken, IERC20[] memory _newCollateralAssets) external onlyManagerAndValidCK(_ckToken) {
        _addCollateralAssets(_ckToken, _newCollateralAssets);
    }
   
    /**
     * @dev MANAGER ONLY: Remove collateral assets. Disable deposited assets to be used as collateral on Aave market.
     * @param _ckToken              Instance of the CKToken
     * @param _collateralAssets     Addresses of collateral underlying assets to remove
     */
    function removeCollateralAssets(ICKToken _ckToken, IERC20[] memory _collateralAssets) external onlyManagerAndValidCK(_ckToken) {
        
        for(uint256 i = 0; i < _collateralAssets.length; i++) {
            IERC20 collateralAsset = _collateralAssets[i];
            require(collateralAssetEnabled[_ckToken][collateralAsset], "Collateral not enabled");
            
            _updateUseReserveAsCollateral(_ckToken, collateralAsset, false);
            
            delete collateralAssetEnabled[_ckToken][collateralAsset];
            enabledAssets[_ckToken].collateralAssets.removeStorage(address(collateralAsset));
        }
        emit CollateralAssetsUpdated(_ckToken, false, _collateralAssets);
    }

    /**
     * @dev MANAGER ONLY: Add borrow assets. Debt tokens corresponding to borrow assets are tracked for syncing positions.
     * Note: Reverts with "Borrow already enabled" if there are duplicate assets in the passed _newBorrowAssets array.
     * @param _ckToken              Instance of the CKToken
     * @param _newBorrowAssets      Addresses of borrow underlying assets to add
     */
    function addBorrowAssets(ICKToken _ckToken, IERC20[] memory _newBorrowAssets) external onlyManagerAndValidCK(_ckToken) {
        _addBorrowAssets(_ckToken, _newBorrowAssets);
    }

    /**
     * @dev MANAGER ONLY: Remove borrow assets.
     * Note: If there is a borrow balance, borrow asset cannot be removed
     * @param _ckToken              Instance of the CKToken
     * @param _borrowAssets         Addresses of borrow underlying assets to remove
     */
    function removeBorrowAssets(ICKToken _ckToken, IERC20[] memory _borrowAssets) external onlyManagerAndValidCK(_ckToken) {
        
        for(uint256 i = 0; i < _borrowAssets.length; i++) {
            IERC20 borrowAsset = _borrowAssets[i];
            
            require(borrowAssetEnabled[_ckToken][borrowAsset], "Borrow not enabled");
            require(underlyingToReserveTokens[borrowAsset].variableDebtToken.balanceOf(address(_ckToken)) == 0, "Variable debt remaining");
    
            delete borrowAssetEnabled[_ckToken][borrowAsset];
            enabledAssets[_ckToken].borrowAssets.removeStorage(address(borrowAsset));
        }
        emit BorrowAssetsUpdated(_ckToken, false, _borrowAssets);
    }

    /**
     * @dev GOVERNANCE ONLY: Enable/disable ability of a CKToken to initialize this module. Only callable by governance.
     * @param _ckToken              Instance of the CKToken
     * @param _status               Bool indicating if _ckToken is allowed to initialize this module
     */
    function updateAllowedCKToken(ICKToken _ckToken, bool _status) external onlyOwner {
        require(controller.isCK(address(_ckToken)) || allowedCKTokens[_ckToken], "Invalid CKToken");
        allowedCKTokens[_ckToken] = _status;
        emit CKTokenStatusUpdated(_ckToken, _status);
    }

    /**
     * @dev GOVERNANCE ONLY: Toggle whether ANY CKToken is allowed to initialize this module. Only callable by governance.
     * @param _anyCKAllowed             Bool indicating if ANY CKToken is allowed to initialize this module
     */
    function updateAnyCKAllowed(bool _anyCKAllowed) external onlyOwner {
        anyCKAllowed = _anyCKAllowed;
        emit AnyCKAllowedUpdated(_anyCKAllowed);
    }

    /**
     * @dev MODULE ONLY: Hook called prior to issuance to sync positions on CKToken. Only callable by valid module.
     * @param _ckToken              Instance of the CKToken
     */
    function moduleIssueHook(ICKToken _ckToken, uint256 /* _ckTokenQuantity */) external override onlyModule(_ckToken) {
        sync(_ckToken);
    }

    /**
     * @dev MODULE ONLY: Hook called prior to redemption to sync positions on CKToken. For redemption, always use current borrowed
     * balance after interest accrual. Only callable by valid module.
     * @param _ckToken              Instance of the CKToken
     */
    function moduleRedeemHook(ICKToken _ckToken, uint256 /* _ckTokenQuantity */) external override onlyModule(_ckToken) {
        sync(_ckToken);
    }

    /**
     * @dev MODULE ONLY: Hook called prior to looping through each component on issuance. Invokes borrow in order for 
     * module to return debt to issuer. Only callable by valid module.
     * @param _ckToken              Instance of the CKToken
     * @param _ckTokenQuantity      Quantity of CKToken
     * @param _component            Address of component
     */
    function componentIssueHook(ICKToken _ckToken, uint256 _ckTokenQuantity, IERC20 _component, bool _isEquity) external override onlyModule(_ckToken) {
        // Check hook not being called for an equity position. If hook is called with equity position and outstanding borrow position
        // exists the loan would be taken out twice potentially leading to liquidation
        if (!_isEquity) {
            int256 componentDebt = _ckToken.getExternalPositionRealUnit(address(_component), address(this));

            require(componentDebt < 0, "Component must be negative");

            uint256 notionalDebt = componentDebt.mul(-1).toUint256().preciseMul(_ckTokenQuantity);
            _borrowForHook(_ckToken, _component, notionalDebt);
        }
    }

    /**
     * @dev MODULE ONLY: Hook called prior to looping through each component on redemption. Invokes repay after 
     * the issuance module transfers debt from the issuer. Only callable by valid module.
     * @param _ckToken              Instance of the CKToken
     * @param _ckTokenQuantity      Quantity of CKToken
     * @param _component            Address of component
     */
    function componentRedeemHook(ICKToken _ckToken, uint256 _ckTokenQuantity, IERC20 _component, bool _isEquity) external override onlyModule(_ckToken) {
        // Check hook not being called for an equity position. If hook is called with equity position and outstanding borrow position
        // exists the loan would be paid down twice, decollateralizing the CK
        if (!_isEquity) {
            int256 componentDebt = _ckToken.getExternalPositionRealUnit(address(_component), address(this));

            require(componentDebt < 0, "Component must be negative");

            uint256 notionalDebt = componentDebt.mul(-1).toUint256().preciseMulCeil(_ckTokenQuantity);
            _repayBorrowForHook(_ckToken, _component, notionalDebt);
        }
    }
    
    /* ============ External Getter Functions ============ */

    /**
     * @dev Get enabled assets for CKToken. Returns an array of collateral and borrow assets.
     * @return Underlying collateral assets that are enabled
     * @return Underlying borrowed assets that are enabled
     */
    function getEnabledAssets(ICKToken _ckToken) external view returns(address[] memory, address[] memory) {
        return (
            enabledAssets[_ckToken].collateralAssets,
            enabledAssets[_ckToken].borrowAssets
        );
    }

    /* ============ Internal Functions ============ */
    
    /**
     * @dev Invoke deposit from CKToken using AaveV2 library. Mints aTokens for CKToken.
     */
    function _deposit(ICKToken _ckToken, ILendingPool _lendingPool, IERC20 _asset, uint256 _notionalQuantity) internal {
        _ckToken.invokeApprove(address(_asset), address(_lendingPool), _notionalQuantity);
        _ckToken.invokeDeposit(_lendingPool, address(_asset), _notionalQuantity);
    }

    /**
     * @dev Invoke withdraw from CKToken using AaveV2 library. Burns aTokens and returns underlying to CKToken.
     */
    function _withdraw(ICKToken _ckToken, ILendingPool _lendingPool, IERC20 _asset, uint256 _notionalQuantity) internal {
        _ckToken.invokeWithdraw(_lendingPool, address(_asset), _notionalQuantity);
    }

    /**
     * @dev Invoke repay from CKToken using AaveV2 library. Burns DebtTokens for CKToken.
     */
    function _repayBorrow(ICKToken _ckToken, ILendingPool _lendingPool, IERC20 _asset, uint256 _notionalQuantity) internal {
        _ckToken.invokeApprove(address(_asset), address(_lendingPool), _notionalQuantity);
        _ckToken.invokeRepay(_lendingPool, address(_asset), _notionalQuantity, BORROW_RATE_MODE);
    }

    /**
     * @dev Invoke borrow from the CKToken during issuance hook. Since we only need to interact with AAVE once we fetch the
     * lending pool in this function to optimize vs forcing a fetch twice during lever/delever.
     */
    function _repayBorrowForHook(ICKToken _ckToken, IERC20 _asset, uint256 _notionalQuantity) internal {
        _repayBorrow(_ckToken, ILendingPool(lendingPoolAddressesProvider.getLendingPool()), _asset, _notionalQuantity);
    }

    /**
     * @dev Invoke borrow from the CKToken using AaveV2 library. Mints DebtTokens for CKToken.
     */
    function _borrow(ICKToken _ckToken, ILendingPool _lendingPool, IERC20 _asset, uint256 _notionalQuantity) internal {
        _ckToken.invokeBorrow(_lendingPool, address(_asset), _notionalQuantity, BORROW_RATE_MODE);
    }

    /**
     * @dev Invoke borrow from the CKToken during issuance hook. Since we only need to interact with AAVE once we fetch the
     * lending pool in this function to optimize vs forcing a fetch twice during lever/delever.
     */
    function _borrowForHook(ICKToken _ckToken, IERC20 _asset, uint256 _notionalQuantity) internal {
        _borrow(_ckToken, ILendingPool(lendingPoolAddressesProvider.getLendingPool()), _asset, _notionalQuantity);
    }
    
    /**
     * @dev Invokes approvals, gets trade call data from exchange adapter and invokes trade from CKToken
     * @return uint256     The quantity of tokens received post-trade
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
     * @dev Calculates protocol fee on module and pays protocol fee from CKToken     
     * @return uint256          Total protocol fee paid
     */
    function _accrueProtocolFee(ICKToken _ckToken, IERC20 _receiveToken, uint256 _exchangedQuantity) internal returns(uint256) {
        uint256 protocolFeeTotal = getModuleFee(PROTOCOL_TRADE_FEE_INDEX, _exchangedQuantity);
        
        payProtocolFeeFromCKToken(_ckToken, address(_receiveToken), protocolFeeTotal);

        return protocolFeeTotal;
    }

    /**
     * @dev Updates the collateral (aToken held) and borrow position (variableDebtToken held) of the CKToken
     */
    function _updateLeverPositions(ActionInfo memory _actionInfo, IERC20 _borrowAsset) internal {
        IAToken aToken = underlyingToReserveTokens[_actionInfo.collateralAsset].aToken;
        _updateCollateralPosition(
            _actionInfo.ckToken,
            aToken,
            _getCollateralPosition(
                _actionInfo.ckToken,
                aToken,
                _actionInfo.ckTotalSupply
            )
        );

        _updateBorrowPosition(
            _actionInfo.ckToken,
            _borrowAsset,
            _getBorrowPosition(
                _actionInfo.ckToken,
                _borrowAsset,
                _actionInfo.ckTotalSupply
            )
        );
    }

    /**
     * @dev Updates positions as per _updateLeverPositions and updates Default position for borrow asset in case CK is
     * delevered all the way to zero any remaining borrow asset after the debt is paid can be added as a position.
     */
    function _updateDeleverPositions(ActionInfo memory _actionInfo, IERC20 _repayAsset) internal {
        // if amount of tokens traded for exceeds debt, update default position first to save gas on editing borrow position
        uint256 repayAssetBalance = _repayAsset.balanceOf(address(_actionInfo.ckToken));
        if (repayAssetBalance != _actionInfo.preTradeReceiveTokenBalance) {
            _actionInfo.ckToken.calculateAndEditDefaultPosition(
                address(_repayAsset),
                _actionInfo.ckTotalSupply,
                _actionInfo.preTradeReceiveTokenBalance
            );
        }

        _updateLeverPositions(_actionInfo, _repayAsset);
    }
     
    /**
     * @dev Updates default position unit for given aToken on CKToken
     */
    function _updateCollateralPosition(ICKToken _ckToken, IAToken _aToken, uint256 _newPositionUnit) internal {
        _ckToken.editDefaultPosition(address(_aToken), _newPositionUnit);
    } 

    /**
     * @dev Updates external position unit for given borrow asset on CKToken
     */
    function _updateBorrowPosition(ICKToken _ckToken, IERC20 _underlyingAsset, int256 _newPositionUnit) internal {
        _ckToken.editExternalPosition(address(_underlyingAsset), address(this), _newPositionUnit, "");
    }

    /**
     * @dev Construct the ActionInfo struct for lever and delever
     * @return ActionInfo       Instance of constructed ActionInfo struct
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
            _isLever,
            totalSupply
        );
    }
    
    /**
     * @dev Construct the ActionInfo struct for lever and delever accepting notional units     
     * @return ActionInfo       Instance of constructed ActionInfo struct
     */
    function _createAndValidateActionInfoNotional(
        ICKToken _ckToken,
        IERC20 _sendToken,
        IERC20 _receiveToken,
        uint256 _notionalSendQuantity,
        uint256 _minNotionalReceiveQuantity,
        string memory _tradeAdapterName,
        bool _isLever,
        uint256 _ckTotalSupply
    )
        internal
        view
        returns(ActionInfo memory)
    {
        ActionInfo memory actionInfo = ActionInfo ({
            exchangeAdapter: IExchangeAdapter(getAndValidateAdapter(_tradeAdapterName)),
            lendingPool: ILendingPool(lendingPoolAddressesProvider.getLendingPool()),
            ckToken: _ckToken,
            collateralAsset: _isLever ? _receiveToken : _sendToken,
            borrowAsset: _isLever ? _sendToken : _receiveToken,
            ckTotalSupply: _ckTotalSupply,
            notionalSendQuantity: _notionalSendQuantity,
            minNotionalReceiveQuantity: _minNotionalReceiveQuantity,
            preTradeReceiveTokenBalance: IERC20(_receiveToken).balanceOf(address(_ckToken))
        });

        _validateCommon(actionInfo);

        return actionInfo;
    }

    /**
     * @dev Updates `underlyingToReserveTokens` mappings for given `_underlying` asset. Emits ReserveTokensUpdated event.
     */
    function _addUnderlyingToReserveTokensMapping(IERC20 _underlying) internal {
        (address aToken, , address variableDebtToken) = protocolDataProvider.getReserveTokensAddresses(address(_underlying));
        underlyingToReserveTokens[_underlying].aToken = IAToken(aToken);
        underlyingToReserveTokens[_underlying].variableDebtToken = IVariableDebtToken(variableDebtToken);

        emit ReserveTokensUpdated(_underlying, IAToken(aToken), IVariableDebtToken(variableDebtToken));
    }

    /**
     * @dev Add collateral assets to CKToken. Updates the collateralAssetsEnabled and enabledAssets mappings.
     * Emits CollateralAssetsUpdated event.
     */
    function _addCollateralAssets(ICKToken _ckToken, IERC20[] memory _newCollateralAssets) internal {
        for(uint256 i = 0; i < _newCollateralAssets.length; i++) {
            IERC20 collateralAsset = _newCollateralAssets[i];
            
            _validateNewCollateralAsset(_ckToken, collateralAsset);
            _updateUseReserveAsCollateral(_ckToken, collateralAsset, true);
            
            collateralAssetEnabled[_ckToken][collateralAsset] = true;
            enabledAssets[_ckToken].collateralAssets.push(address(collateralAsset));
        }
        emit CollateralAssetsUpdated(_ckToken, true, _newCollateralAssets);
    }

    /**
     * @dev Add borrow assets to CKToken. Updates the borrowAssetsEnabled and enabledAssets mappings.
     * Emits BorrowAssetsUpdated event.
     */
    function _addBorrowAssets(ICKToken _ckToken, IERC20[] memory _newBorrowAssets) internal {
        for(uint256 i = 0; i < _newBorrowAssets.length; i++) {
            IERC20 borrowAsset = _newBorrowAssets[i];
            
            _validateNewBorrowAsset(_ckToken, borrowAsset);
            
            borrowAssetEnabled[_ckToken][borrowAsset] = true;
            enabledAssets[_ckToken].borrowAssets.push(address(borrowAsset));
        }
        emit BorrowAssetsUpdated(_ckToken, true, _newBorrowAssets);
    }

    /**
     * @dev Updates CKToken's ability to use an asset as collateral on Aave
     */
    function _updateUseReserveAsCollateral(ICKToken _ckToken, IERC20 _asset, bool _useAsCollateral) internal {
        /*
        Note: Aave ENABLES an asset to be used as collateral by `to` address in an `aToken.transfer(to, amount)` call provided 
            1. msg.sender (from address) isn't the same as `to` address
            2. `to` address had zero aToken balance before the transfer 
            3. transfer `amount` is greater than 0
        
        Note: Aave DISABLES an asset to be used as collateral by `msg.sender`in an `aToken.transfer(to, amount)` call provided 
            1. msg.sender (from address) isn't the same as `to` address
            2. msg.sender has zero balance after the transfer

        Different states of the CKToken and what this function does in those states:

            Case 1: Manager adds collateral asset to CKToken before first issuance
                - Since aToken.balanceOf(ckToken) == 0, we do not call `ckToken.invokeUserUseReserveAsCollateral` because Aave 
                requires aToken balance to be greater than 0 before enabling/disabling the underlying asset to be used as collateral 
                on Aave markets.
        
            Case 2: First issuance of the CKToken
                - CKToken was initialized with aToken as default position
                - DebtIssuanceModule reads the default position and transfers corresponding aToken from the issuer to the CKToken
                - Aave enables aToken to be used as collateral by the CKToken
                - Manager calls lever() and the aToken is used as collateral to borrow other assets

            Case 3: Manager removes collateral asset from the CKToken
                - Disable asset to be used as collateral on CKToken by calling `ckToken.invokeSetUserUseReserveAsCollateral` with 
                useAsCollateral equals false
                - Note: If health factor goes below 1 by removing the collateral asset, then Aave reverts on the above call, thus whole
                transaction reverts, and manager can't remove corresponding collateral asset
        
            Case 4: Manager adds collateral asset after removing it
                - If aToken.balanceOf(ckToken) > 0, we call `ckToken.invokeUserUseReserveAsCollateral` and the corresponding aToken 
                is re-enabled as collateral on Aave
        
            Case 5: On redemption/delever/liquidated and aToken balance becomes zero
                - Aave disables aToken to be used as collateral by CKToken

        Values of variables in below if condition and corresponding action taken:

        ---------------------------------------------------------------------------------------------------------------------
        | usageAsCollateralEnabled |  _useAsCollateral |   aToken.balanceOf()  |     Action                                 |
        |--------------------------|-------------------|-----------------------|--------------------------------------------|
        |   true                   |   true            |      X                |   Skip invoke. Save gas.                   |
        |--------------------------|-------------------|-----------------------|--------------------------------------------|
        |   true                   |   false           |   greater than 0      |   Invoke and set to false.                 |
        |--------------------------|-------------------|-----------------------|--------------------------------------------|
        |   true                   |   false           |   = 0                 |   Impossible case. Aave disables usage as  |
        |                          |                   |                       |   collateral when aToken balance becomes 0 |
        |--------------------------|-------------------|-----------------------|--------------------------------------------|
        |   false                  |   false           |     X                 |   Skip invoke. Save gas.                   |
        |--------------------------|-------------------|-----------------------|--------------------------------------------|
        |   false                  |   true            |   greater than 0      |   Invoke and set to true.                  |
        |--------------------------|-------------------|-----------------------|--------------------------------------------|
        |   false                  |   true            |   = 0                 |   Don't invoke. Will revert.               |
        ---------------------------------------------------------------------------------------------------------------------
        */
        (,,,,,,,,bool usageAsCollateralEnabled) = protocolDataProvider.getUserReserveData(address(_asset), address(_ckToken));
        if (
            usageAsCollateralEnabled != _useAsCollateral
            && underlyingToReserveTokens[_asset].aToken.balanceOf(address(_ckToken)) > 0
        ) {
            _ckToken.invokeSetUserUseReserveAsCollateral(
                ILendingPool(lendingPoolAddressesProvider.getLendingPool()),
                address(_asset),
                _useAsCollateral
            );
        }
    }

    /**
     * @dev Validate common requirements for lever and delever
     */
    function _validateCommon(ActionInfo memory _actionInfo) internal view {
        require(collateralAssetEnabled[_actionInfo.ckToken][_actionInfo.collateralAsset], "Collateral not enabled");
        require(borrowAssetEnabled[_actionInfo.ckToken][_actionInfo.borrowAsset], "Borrow not enabled");
        require(_actionInfo.collateralAsset != _actionInfo.borrowAsset, "Collateral and borrow asset must be different");
        require(_actionInfo.notionalSendQuantity > 0, "Quantity is 0");
    }

    /**
     * @dev Validates if a new asset can be added as collateral asset for given CKToken
     */
    function _validateNewCollateralAsset(ICKToken _ckToken, IERC20 _asset) internal view {
        require(!collateralAssetEnabled[_ckToken][_asset], "Collateral already enabled");
        
        (address aToken, , ) = protocolDataProvider.getReserveTokensAddresses(address(_asset));
        require(address(underlyingToReserveTokens[_asset].aToken) == aToken, "Invalid aToken address");
        
        ( , , , , , bool usageAsCollateralEnabled, , , bool isActive, bool isFrozen) = protocolDataProvider.getReserveConfigurationData(address(_asset));
        // An active reserve is an alias for a valid reserve on Aave.
        // We are checking for the availability of the reserve directly on Aave rather than checking our internal `underlyingToReserveTokens` mappings, 
        // because our mappings can be out-of-date if a new reserve is added to Aave
        require(isActive, "Invalid aave reserve");
        // A frozen reserve doesn't allow any new deposit, borrow or rate swap but allows repayments, liquidations and withdrawals
        require(!isFrozen, "Frozen aave reserve");
        require(usageAsCollateralEnabled, "Collateral disabled on Aave");
    }

    /**
     * @dev Validates if a new asset can be added as borrow asset for given CKToken
     */
    function _validateNewBorrowAsset(ICKToken _ckToken, IERC20 _asset) internal view {
        require(!borrowAssetEnabled[_ckToken][_asset], "Borrow already enabled");
        
        ( , , address variableDebtToken) = protocolDataProvider.getReserveTokensAddresses(address(_asset));
        require(address(underlyingToReserveTokens[_asset].variableDebtToken) == variableDebtToken, "Invalid variable debt token address");
        
        (, , , , , , bool borrowingEnabled, , bool isActive, bool isFrozen) = protocolDataProvider.getReserveConfigurationData(address(_asset));
        require(isActive, "Invalid aave reserve");
        require(!isFrozen, "Frozen aave reserve");
        require(borrowingEnabled, "Borrowing disabled on Aave");
    }

    /**
     * @dev Reads aToken balance and calculates default position unit for given collateral aToken and CKToken
     *
     * @return uint256       default collateral position unit          
     */
    function _getCollateralPosition(ICKToken _ckToken, IAToken _aToken, uint256 _ckTotalSupply) internal view returns (uint256) {
        uint256 collateralNotionalBalance = _aToken.balanceOf(address(_ckToken));
        return collateralNotionalBalance.preciseDiv(_ckTotalSupply);
    }
    
    /**
     * @dev Reads variableDebtToken balance and calculates external position unit for given borrow asset and CKToken
     *
     * @return int256       external borrow position unit
     */
    function _getBorrowPosition(ICKToken _ckToken, IERC20 _borrowAsset, uint256 _ckTotalSupply) internal view returns (int256) {
        uint256 borrowNotionalBalance = underlyingToReserveTokens[_borrowAsset].variableDebtToken.balanceOf(address(_ckToken));
        return borrowNotionalBalance.preciseDivCeil(_ckTotalSupply).toInt256().mul(-1);
    }
}