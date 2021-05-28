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
import { Math } from "@openzeppelin/contracts/math/Math.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/SafeCast.sol";
import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";
import { SignedSafeMath } from "@openzeppelin/contracts/math/SignedSafeMath.sol";

import { AddressArrayUtils } from "../../lib/AddressArrayUtils.sol";
import { IController } from "../../interfaces/IController.sol";
import { IExchangeAdapter } from "../../interfaces/IExchangeAdapter.sol";
import { Invoke } from "../lib/Invoke.sol";
import { IDebtIssuanceModule } from "../../interfaces/IDebtIssuanceModule.sol";
import { ICKToken } from "../../interfaces/ICKToken.sol";
import { IComptroller } from "../../interfaces/external/IComptroller.sol";
import { ICErc20 } from "../../interfaces/external/ICErc20.sol";
import { ModuleBase } from "../lib/ModuleBase.sol";
import { Position } from "../lib/Position.sol";
import { PreciseUnitMath } from "../../lib/PreciseUnitMath.sol";

/**
 * @title CompoundLeverageModule
 * @author Cook Finance
 *
 * Smart contract that enables leverage trading using Compound as the lending protocol. This module allows for multiple Compound leverage positions
 * in a CKToken. This does not allow borrowing of assets from Compound alone. Each asset is leveraged when using this module.
 * 
 *
 */
contract CompoundLeverageModule is ModuleBase, ReentrancyGuard {
    using SafeCast for int256;
    using SafeCast for uint256;
    using SafeMath for uint256;
    using SignedSafeMath for int256;
    using Position for uint256;
    using PreciseUnitMath for uint256;
    using PreciseUnitMath for int256;
    using Position for ICKToken;
    using Invoke for ICKToken;
    using AddressArrayUtils for address[];

    /* ============ Structs ============ */

    struct CompoundSettings {
        address[] collateralCTokens;             // Array of cToken collateral assets
        address[] borrowCTokens;                 // Array of cToken borrow assets
        address[] borrowAssets;                  // Array of underlying borrow assets
    }

    struct ActionInfo {
        ICKToken ckToken;
        IExchangeAdapter exchangeAdapter;
        uint256 ckTotalSupply;
        uint256 notionalSendQuantity;
        uint256 minNotionalReceiveQuantity;
        address collateralCTokenAsset;
        address borrowCTokenAsset;
        uint256 preTradeReceiveTokenBalance;
    }

    /* ============ Events ============ */

    event LeverageIncreased(
        ICKToken indexed _ckToken,
        address indexed _borrowAsset,
        address indexed _collateralAsset,
        IExchangeAdapter _exchangeAdapter,
        uint256 _totalBorrowAmount,
        uint256 _totalReceiveAmount,
        uint256 _protocolFee
    );

    event LeverageDecreased(
        ICKToken indexed _ckToken,
        address indexed _collateralAsset,
        address indexed _repayAsset,
        IExchangeAdapter _exchangeAdapter,
        uint256 _totalRedeemAmount,
        uint256 _totalRepayAmount,
        uint256 _protocolFee
    );

    event CompGulped(
        ICKToken indexed _ckToken,
        address indexed _collateralAsset,
        IExchangeAdapter _exchangeAdapter,
        uint256 _totalCompClaimed,
        uint256 _totalReceiveAmount,
        uint256 _protocolFee
    );

    event PositionsSynced(
        ICKToken indexed _ckToken,
        address _caller
    );

    /* ============ Constants ============ */

    // 0 index stores protocol fee % on the controller, charged in the trade function
    uint256 constant internal PROTOCOL_TRADE_FEE_INDEX = 0;

    /* ============ State Variables ============ */

    // Mapping of underlying to CToken. If ETH, then map WETH to cETH
    mapping(address => address) public underlyingToCToken;
    // Weth contract
    address public weth;
    // cETH address
    address public cEther;
    // Compound Comptroller contract
    IComptroller public comptroller;
    // COMP token address
    address public compToken;

    // Mapping to efficiently check if cToken market for collateral asset is valid in CKToken
    mapping(ICKToken => mapping(address => bool)) public isCollateralCTokenEnabled;
    // Mapping to efficiently check if cToken market for borrow asset is valid in CKToken
    mapping(ICKToken => mapping(address => bool)) public isBorrowCTokenEnabled;
    // Mapping of enabled collateral and borrow cTokens for syncing positions
    mapping(ICKToken => CompoundSettings) internal compoundSettings;


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
        address _compToken,
        IComptroller _comptroller,
        address _cEther,
        address _weth
    )
        public
        ModuleBase(_controller)
    {
        compToken = _compToken;
        comptroller = _comptroller;
        cEther = _cEther;
        weth = _weth;

        ICErc20[] memory cTokens = comptroller.getAllMarkets();

        // Loop through cTokens
        for(uint256 i = 0; i < cTokens.length; i++) {
            if (address(cTokens[i]) == _cEther) {
                underlyingToCToken[_weth] = address(cTokens[i]);
            } else {
                address underlying = cTokens[i].underlying();
                underlyingToCToken[underlying] = address(cTokens[i]);
            }
        }
    }

    /* ============ External Functions ============ */

    /**
     * Increases leverage for a given collateral position using a specified borrow asset that is enabled
     *
     * @param _ckToken             Instance of the CKToken
     * @param _borrowAsset          Address of asset being borrowed for leverage
     * @param _collateralAsset      Address of collateral asset
     * @param _borrowQuantity       Quantity of asset to borrow
     * @param _minReceiveQuantity   Minimum amount of collateral asset to receive post trade
     * @param _tradeAdapterName     Name of trade adapter
     * @param _tradeData            Arbitrary data for trade
     */
    function lever(
        ICKToken _ckToken,
        address _borrowAsset,
        address _collateralAsset,
        uint256 _borrowQuantity,
        uint256 _minReceiveQuantity,
        string memory _tradeAdapterName,
        bytes memory _tradeData
    )
        external
        nonReentrant
        onlyManagerAndValidCK(_ckToken)
    {
        // Note: for levering up, send quantity is derived from borrow asset and receive quantity is derived from 
        // collateral asset
        ActionInfo memory leverInfo = _createActionInfo(
            _ckToken,
            _borrowAsset,
            _collateralAsset,
            _borrowQuantity,
            _minReceiveQuantity,
            _tradeAdapterName,
            true
        );

        _validateCommon(leverInfo);

        _borrow(leverInfo.ckToken, leverInfo.borrowCTokenAsset, leverInfo.notionalSendQuantity);

        (uint256 protocolFee, uint256 postTradeCollateralQuantity) = _trade(
            _ckToken,
            _borrowAsset,
            _collateralAsset,
            leverInfo.notionalSendQuantity,
            leverInfo.minNotionalReceiveQuantity,
            leverInfo.preTradeReceiveTokenBalance,
            leverInfo.exchangeAdapter,
            _tradeData
        );

        _mint(leverInfo.ckToken, leverInfo.collateralCTokenAsset, _collateralAsset, postTradeCollateralQuantity);

        // Update CKToken positions
        _updateCollateralPosition(
            leverInfo.ckToken,
            leverInfo.collateralCTokenAsset,
            _getCollateralPosition(
                leverInfo.ckToken,
                leverInfo.collateralCTokenAsset,
                leverInfo.ckTotalSupply
            )
        );

        _updateBorrowPosition(
            leverInfo.ckToken,
            _borrowAsset,
            _getBorrowPosition(
                leverInfo.ckToken,
                leverInfo.borrowCTokenAsset,
                _borrowAsset,
                leverInfo.ckTotalSupply
            )
        );

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
     * Increases leverage for a given collateral position using a specified borrow asset that is enabled
     *
     * @param _ckToken             Instance of the CKToken
     * @param _collateralAsset      Address of collateral asset
     * @param _repayAsset           Address of asset being repaid
     * @param _redeemQuantity       Quantity of collateral asset to delever
     * @param _minRepayQuantity     Minimum amount of repay asset to receive post trade
     * @param _tradeAdapterName     Name of trade adapter
     * @param _tradeData            Arbitrary data for trade
     */
    function delever(
        ICKToken _ckToken,
        address _collateralAsset,
        address _repayAsset,
        uint256 _redeemQuantity,
        uint256 _minRepayQuantity,
        string memory _tradeAdapterName,
        bytes memory _tradeData
    )
        external
        nonReentrant
        onlyManagerAndValidCK(_ckToken)
    {
        // Note: for levering up, send quantity is derived from collateral asset and receive quantity is derived from 
        // repay asset
        ActionInfo memory deleverInfo = _createActionInfo(
            _ckToken,
            _collateralAsset,
            _repayAsset,
            _redeemQuantity,
            _minRepayQuantity,
            _tradeAdapterName,
            false
        );

        _validateCommon(deleverInfo);

        _redeem(deleverInfo.ckToken, deleverInfo.collateralCTokenAsset, deleverInfo.notionalSendQuantity);

        (uint256 protocolFee, uint256 postTradeRepayQuantity) = _trade(
            _ckToken,
            _collateralAsset,
            _repayAsset,
            deleverInfo.notionalSendQuantity,
            deleverInfo.minNotionalReceiveQuantity,
            deleverInfo.preTradeReceiveTokenBalance,
            deleverInfo.exchangeAdapter,
            _tradeData
        );

        _repay(deleverInfo.ckToken, deleverInfo.borrowCTokenAsset, _repayAsset, postTradeRepayQuantity);

        // Update CKToken positions
        _updateCollateralPosition(
            deleverInfo.ckToken,
            deleverInfo.collateralCTokenAsset,
            _getCollateralPosition(deleverInfo.ckToken, deleverInfo.collateralCTokenAsset, deleverInfo.ckTotalSupply)
        );

        _updateBorrowPosition(
            deleverInfo.ckToken,
            _repayAsset,
            _getBorrowPosition(deleverInfo.ckToken, deleverInfo.borrowCTokenAsset, _repayAsset, deleverInfo.ckTotalSupply)
        );

        emit LeverageDecreased(
            _ckToken,
            _collateralAsset,
            _repayAsset,
            deleverInfo.exchangeAdapter,
            deleverInfo.notionalSendQuantity,
            postTradeRepayQuantity,
            protocolFee
        );
    }

    /**
     * Claims COMP and trades for specified collateral asset
     *
     * @param _ckToken                      Instance of the CKToken
     * @param _collateralAsset               Address of collateral asset
     * @param _minNotionalReceiveQuantity    Minimum total amount of collateral asset to receive post trade
     * @param _tradeAdapterName              Name of trade adapter
     * @param _tradeData                     Arbitrary data for trade
     */
    function gulp(
        ICKToken _ckToken,
        address _collateralAsset,
        uint256 _minNotionalReceiveQuantity,
        string memory _tradeAdapterName,
        bytes memory _tradeData
    )
        external
        nonReentrant
        onlyManagerAndValidCK(_ckToken)
    {
        ActionInfo memory gulpInfo = _createGulpInfoAndClaim(
            _ckToken,
            _collateralAsset,
            _tradeAdapterName
        );

        uint256 protocolFee = 0;
        uint256 postTradeCollateralQuantity;
        // Skip trade if collateral asset is COMP
        if (_collateralAsset != compToken) {
            require(gulpInfo.notionalSendQuantity > 0, "Token to sell must be nonzero");

            (protocolFee, postTradeCollateralQuantity) = _trade(
                _ckToken,
                compToken,
                _collateralAsset,
                gulpInfo.notionalSendQuantity,
                _minNotionalReceiveQuantity,
                gulpInfo.preTradeReceiveTokenBalance,
                gulpInfo.exchangeAdapter,
                _tradeData
            );
        } else {
            postTradeCollateralQuantity = gulpInfo.preTradeReceiveTokenBalance;
        }

        _mint(_ckToken, gulpInfo.collateralCTokenAsset, _collateralAsset, postTradeCollateralQuantity);

        // Update CKToken positions
        _updateCollateralPosition(
            _ckToken,
            gulpInfo.collateralCTokenAsset,
            _getCollateralPosition(_ckToken, gulpInfo.collateralCTokenAsset, gulpInfo.ckTotalSupply)
        );

        emit CompGulped(
            _ckToken,
            _collateralAsset,
            gulpInfo.exchangeAdapter,
            gulpInfo.notionalSendQuantity,
            postTradeCollateralQuantity,
            protocolFee
        );
    }

    /**
     * Sync Set positions with Compound
     *
     * @param _ckToken             Instance of the CKToken
     */
    function sync(ICKToken _ckToken) public nonReentrant onlyValidAndInitializedCK(_ckToken) {
        uint256 ckTotalSupply = _ckToken.totalSupply();

        // Loop through collateral assets
        for(uint i = 0; i < compoundSettings[_ckToken].collateralCTokens.length; i++) {
            address collateralCToken = compoundSettings[_ckToken].collateralCTokens[i];
            uint256 previousPositionUnit = _ckToken.getDefaultPositionRealUnit(collateralCToken).toUint256();
            uint256 newPositionUnit = _getCollateralPosition(_ckToken, collateralCToken, ckTotalSupply);

            // If position units changed, then update. E.g. Position liquidated, and collateral position is in fact
            // less than what is tracked
            // Note: Accounts for if position does not exist on CKToken but is tracked in compoundSettings
            if (previousPositionUnit != newPositionUnit) {
              _updateCollateralPosition(_ckToken, collateralCToken, newPositionUnit);
            }
        }

        // Loop through borrow assets
        for(uint i = 0; i < compoundSettings[_ckToken].borrowCTokens.length; i++) {
            address borrowCToken = compoundSettings[_ckToken].borrowCTokens[i];
            address borrowAsset = compoundSettings[_ckToken].borrowAssets[i];

            int256 previousPositionUnit = _ckToken.getExternalPositionRealUnit(borrowAsset, address(this));

            int256 newPositionUnit = _getBorrowPosition(
                _ckToken,
                borrowCToken,
                borrowAsset,
                ckTotalSupply
            );
            // If position units changed, then update. E.g. Interest is accrued or position is liquidated
            // and borrow position is repaid
            // Note: Accounts for if position does not exist on CKToken but is tracked in compoundSettings
            if (newPositionUnit != previousPositionUnit) {
                _updateBorrowPosition(_ckToken, borrowAsset, newPositionUnit);
            }
        }

        emit PositionsSynced(_ckToken, msg.sender);
    }


    /**
     * Initializes this module to the CKToken. Only callable by the CKToken's manager. Note: managers can enable
     * collateral and borrow assets that don't exist as positions on the CKToken
     *
     * @param _ckToken             Instance of the CKToken to initialize
     * @param _collateralAssets     Underlying tokens to be enabled as collateral in the CKToken
     * @param _borrowAssets         Underlying tokens to be enabled as borrow in the CKToken
     */
    function initialize(
        ICKToken _ckToken,
        address[] memory _collateralAssets,
        address[] memory _borrowAssets
    )
        external
        onlyCKManager(_ckToken, msg.sender)
        onlyValidAndPendingCK(_ckToken)
    {
        address[] memory collateralCTokens = new address[](_collateralAssets.length);
        // Loop through collateral assets and set mapping
        for(uint256 i = 0; i < _collateralAssets.length; i++) {
            address cTokenAddress;
            if (_collateralAssets[i] == weth) {
                // Set as cETH if asset is WETH
                cTokenAddress = cEther;
            } else {
                cTokenAddress = underlyingToCToken[_collateralAssets[i]];
                require(cTokenAddress != address(0), "cToken must exist in Compound");
            }
            isCollateralCTokenEnabled[_ckToken][cTokenAddress] = true;
            collateralCTokens[i] = cTokenAddress;
        }
        compoundSettings[_ckToken].collateralCTokens = collateralCTokens;

        address[] memory borrowCTokens = new address[](_borrowAssets.length);
        // Loop through borrow assets 
        for(uint256 i = 0; i < _borrowAssets.length; i++) {
            address cTokenAddress;            
            if (_borrowAssets[i] == weth) {
                // Set as cETH if asset is WETH
                cTokenAddress = cEther;
            } else {
                cTokenAddress = underlyingToCToken[_borrowAssets[i]];
                require(cTokenAddress != address(0), "cToken must exist in Compound");
            }
            isBorrowCTokenEnabled[_ckToken][cTokenAddress] = true;
            borrowCTokens[i] = cTokenAddress;
        }
        compoundSettings[_ckToken].borrowCTokens = borrowCTokens;
        compoundSettings[_ckToken].borrowAssets = _borrowAssets;

        // Initialize module before trying register
        _ckToken.initializeModule();

        // Try if register exists on any of the modules
        syncRegister(_ckToken);
        
        // Enable collateral and borrow assets on Compound. Note: if there is overlap between borrow cTokens and collateral cTokens, markets are entered with no issue
        _enterMarkets(_ckToken, collateralCTokens);
        _enterMarkets(_ckToken, borrowCTokens);
    }

    /**
     * Removes this module from the CKToken, via call by the CKToken. Compound Settings and manager enabled
     * cTokens are deleted
     */
    function removeModule() external override {
        ICKToken ckToken = ICKToken(msg.sender);

        for (uint256 i = 0; i < compoundSettings[ckToken].borrowCTokens.length; i++) {
            address cToken = compoundSettings[ckToken].borrowCTokens[i];

            // Note: if there is an existing borrow balance, will revert and market cannot be exited on Compound
            _exitMarket(ckToken, cToken);

            delete isBorrowCTokenEnabled[ckToken][cToken];
        }

        for (uint256 i = 0; i < compoundSettings[ckToken].collateralCTokens.length; i++) {
            address cToken = compoundSettings[ckToken].collateralCTokens[i];

            _exitMarket(ckToken, cToken);

            delete isCollateralCTokenEnabled[ckToken][cToken];
        }
        
        delete compoundSettings[ckToken];

        // Try if unregister exists on any of the modules
        address[] memory modules = ckToken.getModules();
        for(uint256 i = 0; i < modules.length; i++) {
            try IDebtIssuanceModule(modules[i]).unregister(ckToken) {} catch {}
        }
    }

    /**
     * Sync Compound markets with stored underlying to cToken mapping. Anyone callable
     */
    function syncCompoundMarkets() external {
        ICErc20[] memory cTokens = comptroller.getAllMarkets();

        // Loop through cTokens
        for(uint256 i = 0; i < cTokens.length; i++) {
            if (address(cTokens[i]) != cEther) {
                address underlying = cTokens[i].underlying();

                // If cToken is not in mapping, then add it
                if (underlyingToCToken[underlying] == address(0)) {
                    underlyingToCToken[underlying] = address(cTokens[i]);
                }
            }
        }
    }

    /**
     * Sync registration of this module on CKToken. Anyone callable
     *
     * @param _ckToken             Instance of the CKToken
     */
    function syncRegister(ICKToken _ckToken) public onlyValidAndInitializedCK(_ckToken) {
        address[] memory modules = _ckToken.getModules();
        for(uint256 i = 0; i < modules.length; i++) {
            try IDebtIssuanceModule(modules[i]).register(_ckToken) {} catch {}
        }
    }

    function addCollateralAsset(ICKToken _ckToken, address _newCollateralAsset) external onlyManagerAndValidCK(_ckToken) {
        address cToken = underlyingToCToken[_newCollateralAsset];
        require(cToken != address(0), "cToken must exist in Compound");
        require(!isCollateralCTokenEnabled[_ckToken][cToken], "Collateral cToken is already enabled");
        
        // Note: Will only enter market if cToken is not enabled as a borrow asset as well
        if (!isBorrowCTokenEnabled[_ckToken][cToken]) {
            address[] memory marketsToEnter = new address[](1);
            marketsToEnter[0] = cToken;
            _enterMarkets(_ckToken, marketsToEnter);
        }

        isCollateralCTokenEnabled[_ckToken][cToken] = true;
        compoundSettings[_ckToken].collateralCTokens.push(cToken);
    }

    function removeCollateralAsset(ICKToken _ckToken, address _collateralAsset) external onlyManagerAndValidCK(_ckToken) {
        address cToken = underlyingToCToken[_collateralAsset];
        require(isCollateralCTokenEnabled[_ckToken][cToken], "Collateral cToken is already not enabled");
        
        // Note: Will only exit market if cToken is not enabled as a borrow asset as well
        if (!isBorrowCTokenEnabled[_ckToken][cToken]) {
            _exitMarket(_ckToken, cToken);
        }

        isCollateralCTokenEnabled[_ckToken][cToken] = false;
        compoundSettings[_ckToken].collateralCTokens = compoundSettings[_ckToken].collateralCTokens.remove(cToken);
    }

    function addBorrowAsset(ICKToken _ckToken, address _newBorrowAsset) external onlyManagerAndValidCK(_ckToken) {
        address cToken = underlyingToCToken[_newBorrowAsset];
        require(cToken != address(0), "cToken must exist in Compound");
        require(!isBorrowCTokenEnabled[_ckToken][cToken], "Borrow cToken is already enabled");
        
        // Note: Will only enter market if cToken is not enabled as a borrow asset as well
        if (!isCollateralCTokenEnabled[_ckToken][cToken]) {
            address[] memory marketsToEnter = new address[](1);
            marketsToEnter[0] = cToken;
            _enterMarkets(_ckToken, marketsToEnter);
        }

        isBorrowCTokenEnabled[_ckToken][cToken] = true;
        compoundSettings[_ckToken].borrowCTokens.push(cToken);
        compoundSettings[_ckToken].borrowAssets.push(_newBorrowAsset);
    }

    function removeBorrowAsset(ICKToken _ckToken, address _borrowAsset) external onlyManagerAndValidCK(_ckToken) {
        address cToken = underlyingToCToken[_borrowAsset];
        require(isBorrowCTokenEnabled[_ckToken][cToken], "Borrow cToken is already not enabled");
        
        // Note: Will only exit market if cToken is not enabled as a collateral asset as well
        // If there is an existing borrow balance, will revert and market cannot be exited on Compound
        if (!isCollateralCTokenEnabled[_ckToken][cToken]) {
            _exitMarket(_ckToken, cToken);
        }

        isBorrowCTokenEnabled[_ckToken][cToken] = false;
        compoundSettings[_ckToken].borrowCTokens = compoundSettings[_ckToken].borrowCTokens.remove(cToken);
        compoundSettings[_ckToken].borrowAssets = compoundSettings[_ckToken].borrowAssets.remove(_borrowAsset);
    }

    function moduleIssueHook(ICKToken _ckToken, uint256 /* _ckTokenQuantity */) external onlyModule(_ckToken) {
        sync(_ckToken);
    }

    function moduleRedeemHook(ICKToken _ckToken, uint256 /* _ckTokenQuantity */) external onlyModule(_ckToken) {
        sync(_ckToken);
    }

    function componentIssueHook(ICKToken _ckToken, uint256 _ckTokenQuantity, address _component) external onlyModule(_ckToken) {
        int256 componentDebt = _ckToken.getExternalPositionRealUnit(_component, address(this));
        uint256 notionalDebt = componentDebt.mul(-1).toUint256().preciseMul(_ckTokenQuantity);

        address cToken = underlyingToCToken[_component];

        _borrow(_ckToken, cToken, notionalDebt);
    }

    function componentRedeemHook(ICKToken _ckToken, uint256 _ckTokenQuantity, address _component) external onlyModule(_ckToken) {
        int256 componentDebt = _ckToken.getExternalPositionRealUnit(_component, address(this));
        uint256 notionalDebt = componentDebt.mul(-1).toUint256().preciseMul(_ckTokenQuantity);

        address cToken = underlyingToCToken[_component];

        _repay(_ckToken, cToken, _component, notionalDebt);
    }


    /* ============ External Getter Functions ============ */

    function getEnabledCollateralCTokens(ICKToken _ckToken) external view returns(address[] memory) {
        return compoundSettings[_ckToken].collateralCTokens;
    }

    function getEnabledBorrowCTokens(ICKToken _ckToken) external view returns(address[] memory) {
        return compoundSettings[_ckToken].borrowCTokens;
    }

    function getEnabledBorrowAssets(ICKToken _ckToken) external view returns(address[] memory) {
        return compoundSettings[_ckToken].borrowAssets;
    }

    /* ============ Internal Functions ============ */

    /**
     * Construct the ActionInfo struct for lever and delever
     */
    function _createActionInfo(
        ICKToken _ckToken,
        address _sendToken,
        address _receiveToken,
        uint256 _sendQuantity,
        uint256 _minReceiveQuantity,
        string memory _tradeAdapterName,
        bool isLever
    )
        internal
        view
        returns(ActionInfo memory)
    {
        ActionInfo memory actionInfo;

        actionInfo.exchangeAdapter = IExchangeAdapter(getAndValidateAdapter(_tradeAdapterName));
        actionInfo.ckToken = _ckToken;
        actionInfo.collateralCTokenAsset = isLever ? underlyingToCToken[_receiveToken] : underlyingToCToken[_sendToken];
        actionInfo.borrowCTokenAsset = isLever ? underlyingToCToken[_sendToken] : underlyingToCToken[_receiveToken];
        actionInfo.ckTotalSupply = _ckToken.totalSupply();
        actionInfo.notionalSendQuantity = _sendQuantity.preciseMul(actionInfo.ckTotalSupply);
        actionInfo.minNotionalReceiveQuantity = _minReceiveQuantity.preciseMul(actionInfo.ckTotalSupply);
        // Snapshot pre trade receive token balance.
        actionInfo.preTradeReceiveTokenBalance = IERC20(_receiveToken).balanceOf(address(_ckToken));

        return actionInfo;
    }

    /**
     * Construct the ActionInfo struct for gulp
     */
    function _createGulpInfoAndClaim(
        ICKToken _ckToken,
        address _collateralAsset,
        string memory _tradeAdapterName
    )
        internal
        returns(ActionInfo memory)
    {
        ActionInfo memory actionInfo;

        actionInfo.collateralCTokenAsset = underlyingToCToken[_collateralAsset];
        require(isCollateralCTokenEnabled[_ckToken][actionInfo.collateralCTokenAsset], "Collateral cToken is not enabled");
        actionInfo.exchangeAdapter = IExchangeAdapter(getAndValidateAdapter(_tradeAdapterName));
        actionInfo.ckTotalSupply = _ckToken.totalSupply();
        // Snapshot COMP balances pre claim
        uint256 preClaimCompBalance = IERC20(compToken).balanceOf(address(_ckToken));

        // Claim COMP
        _claim(_ckToken);

        // Snapshot pre trade receive token balance.
        actionInfo.preTradeReceiveTokenBalance = IERC20(_collateralAsset).balanceOf(address(_ckToken));
        // Calculate notional send quantity
        actionInfo.notionalSendQuantity = IERC20(compToken).balanceOf(address(_ckToken)).sub(preClaimCompBalance);
            
        return actionInfo;
    }

    function _validateCommon(ActionInfo memory _actionInfo) internal view {
        require(isCollateralCTokenEnabled[_actionInfo.ckToken][_actionInfo.collateralCTokenAsset], "Collateral cToken is not enabled");
        require(isBorrowCTokenEnabled[_actionInfo.ckToken][_actionInfo.borrowCTokenAsset], "Borrow cToken is not enabled");
        require(_actionInfo.collateralCTokenAsset != _actionInfo.borrowCTokenAsset, "Collateral and borrow assets must be different");
        require(_actionInfo.notionalSendQuantity > 0, "Token to sell must be nonzero");
    }

    /**
     * Invoke enter markets from CKToken
     */
    function _enterMarkets(ICKToken _ckToken, address[] memory _cTokens) internal {
        // enterMarkets(address[] _cTokens)
        bytes memory enterMarketsCallData = abi.encodeWithSignature("enterMarkets(address[])", _cTokens);
        uint256[] memory returnValues = abi.decode(
            _ckToken.invoke(address(comptroller), 0, enterMarketsCallData),
            (uint256[])
        );
        for (uint256 i = 0; i < _cTokens.length; i++) {
            require(
                returnValues[i] == 0,
                "Entering market failed"
            );
        }
    }

    /**
     * Invoke exit market from CKToken
     */
    function _exitMarket(ICKToken _ckToken, address _cToken) internal {
        // exitMarket(address _cToken)
        bytes memory exitMarketCallData = abi.encodeWithSignature("exitMarket(address)", _cToken);
        require(
            abi.decode(_ckToken.invoke(address(comptroller), 0, exitMarketCallData), (uint256)) == 0,
            "Exiting market failed"
        );
    }

    /**
     * Invoke mint from CKToken
     */
    function _mint(ICKToken _ckToken, address _cToken, address _underlyingToken, uint256 _mintNotional) internal {
        if (_cToken == cEther) {
            _ckToken.invokeUnwrapWETH(weth, _mintNotional);

            // mint(). No return, reverts on error.
            bytes memory mintCEthCallData = abi.encodeWithSignature("mint()");
            _ckToken.invoke(_cToken, _mintNotional, mintCEthCallData);
        } else {
            // Approve to cToken
            _ckToken.invokeApprove(_underlyingToken, _cToken, _mintNotional);

            // mint(uint256 _mintAmount). Returns 0 if success
            bytes memory mintCallData = abi.encodeWithSignature("mint(uint256)", _mintNotional);
            require(
                abi.decode(_ckToken.invoke(_cToken, 0, mintCallData), (uint256)) == 0,
                "Mint failed"
            );
        }
    }

    /**
     * Invoke redeem from CKToken
     */
    function _redeem(ICKToken _ckToken, address _cToken, uint256 _redeemNotional) internal {
        // redeemUnderlying(uint256 _underlyingAmount)
        bytes memory redeemCallData = abi.encodeWithSignature("redeemUnderlying(uint256)", _redeemNotional);

        require(
            abi.decode(_ckToken.invoke(_cToken, 0, redeemCallData), (uint256)) == 0,
            "Redeem failed"
        );

        if (_cToken == cEther) {
            _ckToken.invokeWrapWETH(weth, _redeemNotional);
        }
    }

    /**
     * Invoke repay from CKToken
     */
    function _repay(ICKToken _ckToken, address _cToken, address _underlyingToken, uint256 _repayNotional) internal {
        if (_cToken == cEther) {
            _ckToken.invokeUnwrapWETH(weth, _repayNotional);

            // repay(). No return, revert on fail
            bytes memory repayCEthCallData = abi.encodeWithSignature("repayBorrow()");
            _ckToken.invoke(_cToken, _repayNotional, repayCEthCallData);
        } else {
            // Approve to cToken
            _ckToken.invokeApprove(_underlyingToken, _cToken, _repayNotional);
            // repay(uint256 _repayAmount)
            bytes memory repayCallData = abi.encodeWithSignature("repayBorrow(uint256)", _repayNotional);
            require(
                abi.decode(_ckToken.invoke(_cToken, 0, repayCallData), (uint256)) == 0,
                "Repay failed"
            );
        }
    }

    /**
     * Invoke borrow from CKToken
     */
    function _borrow(ICKToken _ckToken, address _cToken, uint256 _notionalBorrowQuantity) internal {
        // borrow(uint256 _borrowAmount). Note: Notional borrow quantity is in units of underlying asset
        bytes memory borrowCallData = abi.encodeWithSignature("borrow(uint256)", _notionalBorrowQuantity);

        require(
            abi.decode(_ckToken.invoke(_cToken, 0, borrowCallData), (uint256)) == 0,
            "Borrow failed"
        );
        if (_cToken == cEther) {
            _ckToken.invokeWrapWETH(weth, _notionalBorrowQuantity);
        }
    }

    /**
     * Invoke trade from CKToken
     */
    function _trade(
        ICKToken _ckToken,
        address _sendToken,
        address _receiveToken,
        uint256 _notionalSendQuantity,
        uint256 _minNotionalReceiveQuantity,
        uint256 _preTradeReceiveTokenBalance,
        IExchangeAdapter _exchangeAdapter,
        bytes memory _data
    )
        internal
        returns(uint256, uint256)
    {
        _executeTrade(
            _ckToken,
            _sendToken,
            _receiveToken,
            _notionalSendQuantity,
            _minNotionalReceiveQuantity,
            _exchangeAdapter,
            _data
        );

        uint256 receiveTokenQuantity = IERC20(_receiveToken).balanceOf(address(_ckToken)).sub(_preTradeReceiveTokenBalance);
        require(
            receiveTokenQuantity >= _minNotionalReceiveQuantity,
            "Slippage greater than allowed"
        );

        // Accrue protocol fee
        uint256 protocolFeeTotal = _accrueProtocolFee(_ckToken, _receiveToken, receiveTokenQuantity);

        return (protocolFeeTotal, receiveTokenQuantity.sub(protocolFeeTotal));
    }

    function _executeTrade(
        ICKToken _ckToken,
        address _sendToken,
        address _receiveToken,
        uint256 _notionalSendQuantity,
        uint256 _minNotionalReceiveQuantity,
        IExchangeAdapter _exchangeAdapter,
        bytes memory _data
    )
        internal
    {
         _ckToken.invokeApprove(
            _sendToken,
            _exchangeAdapter.getSpender(),
            _notionalSendQuantity
        );

        (
            address targetExchange,
            uint256 callValue,
            bytes memory methodData
        ) = _exchangeAdapter.getTradeCalldata(
            _sendToken,
            _receiveToken,
            address(_ckToken),
            _notionalSendQuantity,
            _minNotionalReceiveQuantity,
            _data
        );

        _ckToken.invoke(targetExchange, callValue, methodData);
    }

    function _accrueProtocolFee(ICKToken _ckToken, address _receiveToken, uint256 _exchangedQuantity) internal returns(uint256) {
        // Accrue protocol fee
        uint256 protocolFeeTotal = getModuleFee(PROTOCOL_TRADE_FEE_INDEX, _exchangedQuantity);
        
        payProtocolFeeFromCKToken(_ckToken, _receiveToken, protocolFeeTotal);

        return protocolFeeTotal;
    }

    /**
     * Invoke claim COMP from CKToken
     */
    function _claim(ICKToken _ckToken) internal {
        // claimComp(address _holder)
        bytes memory claimCallData = abi.encodeWithSignature("claimComp(address)", address(_ckToken));

        _ckToken.invoke(address(comptroller), 0, claimCallData);
    }

    function _getCollateralPosition(ICKToken _ckToken, address _cToken, uint256 _ckTotalSupply) internal view returns (uint256) {
        uint256 collateralNotionalBalance = IERC20(_cToken).balanceOf(address(_ckToken));
        return collateralNotionalBalance.preciseDiv(_ckTotalSupply);
    }

    function _getBorrowPosition(ICKToken _ckToken, address _cToken, address _underlyingToken, uint256 _ckTotalSupply) internal returns (int256) {
        uint256 borrowNotionalBalance = ICErc20(_cToken).borrowBalanceCurrent(address(_ckToken));
        // Round negative away from 0
        return borrowNotionalBalance.preciseDivCeil(_ckTotalSupply).toInt256().mul(-1);
    }

    function _updateCollateralPosition(ICKToken _ckToken, address _cToken, uint256 _newPositionUnit) internal {
        _ckToken.editDefaultPosition(_cToken, _newPositionUnit);
    }

    function _updateBorrowPosition(ICKToken _ckToken, address _underlyingToken, int256 _newPositionUnit) internal {
        _ckToken.editExternalPosition(_underlyingToken, address(this), _newPositionUnit, "");
    }
}