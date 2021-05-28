pragma solidity 0.6.10;
pragma experimental "ABIEncoderV2";

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/SafeCast.sol";
import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";
import { SignedSafeMath } from "@openzeppelin/contracts/math/SignedSafeMath.sol";

import { Invoke } from "../../../protocol/lib/Invoke.sol";
import { IController } from "../../../interfaces/IController.sol";
import { IDebtIssuanceModule } from "../../../interfaces/IDebtIssuanceModule.sol";
import { ICKToken } from "../../../interfaces/ICKToken.sol";
import { ModuleBase } from "../../../protocol/lib/ModuleBase.sol";
import { Position } from "../../../protocol/lib/Position.sol";


// Mock for modules that handle debt positions. Used for testing DebtIssuanceModule
contract DebtModuleMock is ModuleBase {
    using SafeCast for uint256;
    using Position for uint256;
    using SafeCast for int256;
    using SignedSafeMath for int256;
    using Position for ICKToken;
    using Invoke for ICKToken;

    address public module;
    bool public moduleIssueHookCalled;
    bool public moduleRedeemHookCalled;

    constructor(IController _controller, address _module) public ModuleBase(_controller) {
        module = _module;
    }

    function addDebt(ICKToken _ckToken, address _token, uint256 _amount) external {
        _ckToken.editExternalPosition(_token, address(this), _amount.toInt256().mul(-1), "");
    }

    function moduleIssueHook(ICKToken /*_ckToken*/, uint256 /*_ckTokenQuantity*/) external { moduleIssueHookCalled = true; }
    function moduleRedeemHook(ICKToken /*_ckToken*/, uint256 /*_ckTokenQuantity*/) external { moduleRedeemHookCalled = true; }
    
    function componentIssueHook(
        ICKToken _ckToken,
        uint256 _ckTokenQuantity,
        address _component,
        bool /* _isEquity */
    )
        external
    {
        uint256 unitAmount = _ckToken.getExternalPositionRealUnit(_component, address(this)).mul(-1).toUint256();
        uint256 notionalAmount = _ckTokenQuantity.getDefaultTotalNotional(unitAmount);
        IERC20(_component).transfer(address(_ckToken), notionalAmount);
    }

    function componentRedeemHook(
        ICKToken _ckToken,
        uint256 _ckTokenQuantity,
        address _component,
        bool /* _isEquity */
    )
        external
    {
        uint256 unitAmount = _ckToken.getExternalPositionRealUnit(_component, address(this)).mul(-1).toUint256();
        uint256 notionalAmount = _ckTokenQuantity.getDefaultTotalNotional(unitAmount);
        _ckToken.invokeTransfer(_component, address(this), notionalAmount);
    }

    function initialize(ICKToken _ckToken) external {
        _ckToken.initializeModule();
        IDebtIssuanceModule(module).registerToIssuanceModule(_ckToken);
    }

    function removeModule() external override {
        IDebtIssuanceModule(module).unregisterFromIssuanceModule(ICKToken(msg.sender));
    }
}