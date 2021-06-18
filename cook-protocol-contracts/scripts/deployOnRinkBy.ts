import { ethers } from "hardhat";
import { ContractTransaction } from "ethers";
import { ProtocolUtils } from "../utils/common";
import { CKToken__factory } from "../typechain/factories/CKToken__factory";
import BigNumber from "bignumber.js";

const ERC20ABI = [ { inputs: [ { internalType: "string", name: "name", type: "string" }, { internalType: "string", name: "symbol", type: "string" }, { internalType: "uint8", name: "decimals", type: "uint8" }, { internalType: "uint256", name: "cap", type: "uint256" }, { internalType: "uint256", name: "initialBalance", type: "uint256" }, { internalType: "address payable", name: "feeReceiver", type: "address" }, ], stateMutability: "payable", type: "constructor", }, { anonymous: false, inputs: [ { indexed: true, internalType: "address", name: "owner", type: "address" }, { indexed: true, internalType: "address", name: "spender", type: "address" }, { indexed: false, internalType: "uint256", name: "value", type: "uint256" }, ], name: "Approval", type: "event", }, { anonymous: false, inputs: [], name: "MintFinished", type: "event" }, { anonymous: false, inputs: [ { indexed: true, internalType: "address", name: "previousOwner", type: "address" }, { indexed: true, internalType: "address", name: "newOwner", type: "address" }, ], name: "OwnershipTransferred", type: "event", }, { anonymous: false, inputs: [ { indexed: true, internalType: "address", name: "from", type: "address" }, { indexed: true, internalType: "address", name: "to", type: "address" }, { indexed: false, internalType: "uint256", name: "value", type: "uint256" }, ], name: "Transfer", type: "event", }, { inputs: [ { internalType: "address", name: "owner", type: "address" }, { internalType: "address", name: "spender", type: "address" }, ], name: "allowance", outputs: [{ internalType: "uint256", name: "", type: "uint256" }], stateMutability: "view", type: "function", }, { inputs: [ { internalType: "address", name: "spender", type: "address" }, { internalType: "uint256", name: "amount", type: "uint256" }, ], name: "approve", outputs: [{ internalType: "bool", name: "", type: "bool" }], stateMutability: "nonpayable", type: "function", }, { inputs: [{ internalType: "address", name: "account", type: "address" }], name: "balanceOf", outputs: [{ internalType: "uint256", name: "", type: "uint256" }], stateMutability: "view", type: "function", }, { inputs: [], name: "cap", outputs: [{ internalType: "uint256", name: "", type: "uint256" }], stateMutability: "view", type: "function", }, { inputs: [], name: "decimals", outputs: [{ internalType: "uint8", name: "", type: "uint8" }], stateMutability: "view", type: "function", }, { inputs: [ { internalType: "address", name: "spender", type: "address" }, { internalType: "uint256", name: "subtractedValue", type: "uint256" }, ], name: "decreaseAllowance", outputs: [{ internalType: "bool", name: "", type: "bool" }], stateMutability: "nonpayable", type: "function", }, { inputs: [], name: "finishMinting", outputs: [], stateMutability: "nonpayable", type: "function", }, { inputs: [ { internalType: "address", name: "spender", type: "address" }, { internalType: "uint256", name: "addedValue", type: "uint256" }, ], name: "increaseAllowance", outputs: [{ internalType: "bool", name: "", type: "bool" }], stateMutability: "nonpayable", type: "function", }, { inputs: [ { internalType: "address", name: "account", type: "address" }, { internalType: "uint256", name: "amount", type: "uint256" }, ], name: "mint", outputs: [], stateMutability: "nonpayable", type: "function", }, { inputs: [], name: "mintingFinished", outputs: [{ internalType: "bool", name: "", type: "bool" }], stateMutability: "view", type: "function", }, { inputs: [], name: "name", outputs: [{ internalType: "string", name: "", type: "string" }], stateMutability: "view", type: "function", }, { inputs: [], name: "owner", outputs: [{ internalType: "address", name: "", type: "address" }], stateMutability: "view", type: "function", }, { inputs: [], name: "renounceOwnership", outputs: [], stateMutability: "nonpayable", type: "function", }, { inputs: [], name: "symbol", outputs: [{ internalType: "string", name: "", type: "string" }], stateMutability: "view", type: "function", }, { inputs: [], name: "totalSupply", outputs: [{ internalType: "uint256", name: "", type: "uint256" }], stateMutability: "view", type: "function", }, { inputs: [ { internalType: "address", name: "recipient", type: "address" }, { internalType: "uint256", name: "amount", type: "uint256" }, ], name: "transfer", outputs: [{ internalType: "bool", name: "", type: "bool" }], stateMutability: "nonpayable", type: "function", }, { inputs: [ { internalType: "address", name: "sender", type: "address" }, { internalType: "address", name: "recipient", type: "address" }, { internalType: "uint256", name: "amount", type: "uint256" }, ], name: "transferFrom", outputs: [{ internalType: "bool", name: "", type: "bool" }], stateMutability: "nonpayable", type: "function", }, { inputs: [{ internalType: "address", name: "newOwner", type: "address" }], name: "transferOwnership", outputs: [], stateMutability: "nonpayable", type: "function", }, ];
const UNIV2RouterABI = [ { inputs: [ { internalType: "address", name: "_factory", type: "address" }, { internalType: "address", name: "_WETH", type: "address" }, ], stateMutability: "nonpayable", type: "constructor", }, { inputs: [], name: "WETH", outputs: [{ internalType: "address", name: "", type: "address" }], stateMutability: "view", type: "function", }, { inputs: [ { internalType: "address", name: "tokenA", type: "address" }, { internalType: "address", name: "tokenB", type: "address" }, { internalType: "uint256", name: "amountADesired", type: "uint256" }, { internalType: "uint256", name: "amountBDesired", type: "uint256" }, { internalType: "uint256", name: "amountAMin", type: "uint256" }, { internalType: "uint256", name: "amountBMin", type: "uint256" }, { internalType: "address", name: "to", type: "address" }, { internalType: "uint256", name: "deadline", type: "uint256" }, ], name: "addLiquidity", outputs: [ { internalType: "uint256", name: "amountA", type: "uint256" }, { internalType: "uint256", name: "amountB", type: "uint256" }, { internalType: "uint256", name: "liquidity", type: "uint256" }, ], stateMutability: "nonpayable", type: "function", }, { inputs: [ { internalType: "address", name: "token", type: "address" }, { internalType: "uint256", name: "amountTokenDesired", type: "uint256" }, { internalType: "uint256", name: "amountTokenMin", type: "uint256" }, { internalType: "uint256", name: "amountETHMin", type: "uint256" }, { internalType: "address", name: "to", type: "address" }, { internalType: "uint256", name: "deadline", type: "uint256" }, ], name: "addLiquidityETH", outputs: [ { internalType: "uint256", name: "amountToken", type: "uint256" }, { internalType: "uint256", name: "amountETH", type: "uint256" }, { internalType: "uint256", name: "liquidity", type: "uint256" }, ], stateMutability: "payable", type: "function", }, { inputs: [], name: "factory", outputs: [{ internalType: "address", name: "", type: "address" }], stateMutability: "view", type: "function", }, { inputs: [ { internalType: "uint256", name: "amountOut", type: "uint256" }, { internalType: "uint256", name: "reserveIn", type: "uint256" }, { internalType: "uint256", name: "reserveOut", type: "uint256" }, ], name: "getAmountIn", outputs: [{ internalType: "uint256", name: "amountIn", type: "uint256" }], stateMutability: "pure", type: "function", }, { inputs: [ { internalType: "uint256", name: "amountIn", type: "uint256" }, { internalType: "uint256", name: "reserveIn", type: "uint256" }, { internalType: "uint256", name: "reserveOut", type: "uint256" }, ], name: "getAmountOut", outputs: [{ internalType: "uint256", name: "amountOut", type: "uint256" }], stateMutability: "pure", type: "function", }, { inputs: [ { internalType: "uint256", name: "amountOut", type: "uint256" }, { internalType: "address[]", name: "path", type: "address[]" }, ], name: "getAmountsIn", outputs: [{ internalType: "uint256[]", name: "amounts", type: "uint256[]" }], stateMutability: "view", type: "function", }, { inputs: [ { internalType: "uint256", name: "amountIn", type: "uint256" }, { internalType: "address[]", name: "path", type: "address[]" }, ], name: "getAmountsOut", outputs: [{ internalType: "uint256[]", name: "amounts", type: "uint256[]" }], stateMutability: "view", type: "function", }, { inputs: [ { internalType: "uint256", name: "amountA", type: "uint256" }, { internalType: "uint256", name: "reserveA", type: "uint256" }, { internalType: "uint256", name: "reserveB", type: "uint256" }, ], name: "quote", outputs: [{ internalType: "uint256", name: "amountB", type: "uint256" }], stateMutability: "pure", type: "function", }, { inputs: [ { internalType: "address", name: "tokenA", type: "address" }, { internalType: "address", name: "tokenB", type: "address" }, { internalType: "uint256", name: "liquidity", type: "uint256" }, { internalType: "uint256", name: "amountAMin", type: "uint256" }, { internalType: "uint256", name: "amountBMin", type: "uint256" }, { internalType: "address", name: "to", type: "address" }, { internalType: "uint256", name: "deadline", type: "uint256" }, ], name: "removeLiquidity", outputs: [ { internalType: "uint256", name: "amountA", type: "uint256" }, { internalType: "uint256", name: "amountB", type: "uint256" }, ], stateMutability: "nonpayable", type: "function", }, { inputs: [ { internalType: "address", name: "token", type: "address" }, { internalType: "uint256", name: "liquidity", type: "uint256" }, { internalType: "uint256", name: "amountTokenMin", type: "uint256" }, { internalType: "uint256", name: "amountETHMin", type: "uint256" }, { internalType: "address", name: "to", type: "address" }, { internalType: "uint256", name: "deadline", type: "uint256" }, ], name: "removeLiquidityETH", outputs: [ { internalType: "uint256", name: "amountToken", type: "uint256" }, { internalType: "uint256", name: "amountETH", type: "uint256" }, ], stateMutability: "nonpayable", type: "function", }, { inputs: [ { internalType: "address", name: "token", type: "address" }, { internalType: "uint256", name: "liquidity", type: "uint256" }, { internalType: "uint256", name: "amountTokenMin", type: "uint256" }, { internalType: "uint256", name: "amountETHMin", type: "uint256" }, { internalType: "address", name: "to", type: "address" }, { internalType: "uint256", name: "deadline", type: "uint256" }, ], name: "removeLiquidityETHSupportingFeeOnTransferTokens", outputs: [{ internalType: "uint256", name: "amountETH", type: "uint256" }], stateMutability: "nonpayable", type: "function", }, { inputs: [ { internalType: "address", name: "token", type: "address" }, { internalType: "uint256", name: "liquidity", type: "uint256" }, { internalType: "uint256", name: "amountTokenMin", type: "uint256" }, { internalType: "uint256", name: "amountETHMin", type: "uint256" }, { internalType: "address", name: "to", type: "address" }, { internalType: "uint256", name: "deadline", type: "uint256" }, { internalType: "bool", name: "approveMax", type: "bool" }, { internalType: "uint8", name: "v", type: "uint8" }, { internalType: "bytes32", name: "r", type: "bytes32" }, { internalType: "bytes32", name: "s", type: "bytes32" }, ], name: "removeLiquidityETHWithPermit", outputs: [ { internalType: "uint256", name: "amountToken", type: "uint256" }, { internalType: "uint256", name: "amountETH", type: "uint256" }, ], stateMutability: "nonpayable", type: "function", }, { inputs: [ { internalType: "address", name: "token", type: "address" }, { internalType: "uint256", name: "liquidity", type: "uint256" }, { internalType: "uint256", name: "amountTokenMin", type: "uint256" }, { internalType: "uint256", name: "amountETHMin", type: "uint256" }, { internalType: "address", name: "to", type: "address" }, { internalType: "uint256", name: "deadline", type: "uint256" }, { internalType: "bool", name: "approveMax", type: "bool" }, { internalType: "uint8", name: "v", type: "uint8" }, { internalType: "bytes32", name: "r", type: "bytes32" }, { internalType: "bytes32", name: "s", type: "bytes32" }, ], name: "removeLiquidityETHWithPermitSupportingFeeOnTransferTokens", outputs: [{ internalType: "uint256", name: "amountETH", type: "uint256" }], stateMutability: "nonpayable", type: "function", }, { inputs: [ { internalType: "address", name: "tokenA", type: "address" }, { internalType: "address", name: "tokenB", type: "address" }, { internalType: "uint256", name: "liquidity", type: "uint256" }, { internalType: "uint256", name: "amountAMin", type: "uint256" }, { internalType: "uint256", name: "amountBMin", type: "uint256" }, { internalType: "address", name: "to", type: "address" }, { internalType: "uint256", name: "deadline", type: "uint256" }, { internalType: "bool", name: "approveMax", type: "bool" }, { internalType: "uint8", name: "v", type: "uint8" }, { internalType: "bytes32", name: "r", type: "bytes32" }, { internalType: "bytes32", name: "s", type: "bytes32" }, ], name: "removeLiquidityWithPermit", outputs: [ { internalType: "uint256", name: "amountA", type: "uint256" }, { internalType: "uint256", name: "amountB", type: "uint256" }, ], stateMutability: "nonpayable", type: "function", }, { inputs: [ { internalType: "uint256", name: "amountOut", type: "uint256" }, { internalType: "address[]", name: "path", type: "address[]" }, { internalType: "address", name: "to", type: "address" }, { internalType: "uint256", name: "deadline", type: "uint256" }, ], name: "swapETHForExactTokens", outputs: [{ internalType: "uint256[]", name: "amounts", type: "uint256[]" }], stateMutability: "payable", type: "function", }, { inputs: [ { internalType: "uint256", name: "amountOutMin", type: "uint256" }, { internalType: "address[]", name: "path", type: "address[]" }, { internalType: "address", name: "to", type: "address" }, { internalType: "uint256", name: "deadline", type: "uint256" }, ], name: "swapExactETHForTokens", outputs: [{ internalType: "uint256[]", name: "amounts", type: "uint256[]" }], stateMutability: "payable", type: "function", }, { inputs: [ { internalType: "uint256", name: "amountOutMin", type: "uint256" }, { internalType: "address[]", name: "path", type: "address[]" }, { internalType: "address", name: "to", type: "address" }, { internalType: "uint256", name: "deadline", type: "uint256" }, ], name: "swapExactETHForTokensSupportingFeeOnTransferTokens", outputs: [], stateMutability: "payable", type: "function", }, { inputs: [ { internalType: "uint256", name: "amountIn", type: "uint256" }, { internalType: "uint256", name: "amountOutMin", type: "uint256" }, { internalType: "address[]", name: "path", type: "address[]" }, { internalType: "address", name: "to", type: "address" }, { internalType: "uint256", name: "deadline", type: "uint256" }, ], name: "swapExactTokensForETH", outputs: [{ internalType: "uint256[]", name: "amounts", type: "uint256[]" }], stateMutability: "nonpayable", type: "function", }, { inputs: [ { internalType: "uint256", name: "amountIn", type: "uint256" }, { internalType: "uint256", name: "amountOutMin", type: "uint256" }, { internalType: "address[]", name: "path", type: "address[]" }, { internalType: "address", name: "to", type: "address" }, { internalType: "uint256", name: "deadline", type: "uint256" }, ], name: "swapExactTokensForETHSupportingFeeOnTransferTokens", outputs: [], stateMutability: "nonpayable", type: "function", }, { inputs: [ { internalType: "uint256", name: "amountIn", type: "uint256" }, { internalType: "uint256", name: "amountOutMin", type: "uint256" }, { internalType: "address[]", name: "path", type: "address[]" }, { internalType: "address", name: "to", type: "address" }, { internalType: "uint256", name: "deadline", type: "uint256" }, ], name: "swapExactTokensForTokens", outputs: [{ internalType: "uint256[]", name: "amounts", type: "uint256[]" }], stateMutability: "nonpayable", type: "function", }, { inputs: [ { internalType: "uint256", name: "amountIn", type: "uint256" }, { internalType: "uint256", name: "amountOutMin", type: "uint256" }, { internalType: "address[]", name: "path", type: "address[]" }, { internalType: "address", name: "to", type: "address" }, { internalType: "uint256", name: "deadline", type: "uint256" }, ], name: "swapExactTokensForTokensSupportingFeeOnTransferTokens", outputs: [], stateMutability: "nonpayable", type: "function", }, { inputs: [ { internalType: "uint256", name: "amountOut", type: "uint256" }, { internalType: "uint256", name: "amountInMax", type: "uint256" }, { internalType: "address[]", name: "path", type: "address[]" }, { internalType: "address", name: "to", type: "address" }, { internalType: "uint256", name: "deadline", type: "uint256" }, ], name: "swapTokensForExactETH", outputs: [{ internalType: "uint256[]", name: "amounts", type: "uint256[]" }], stateMutability: "nonpayable", type: "function", }, { inputs: [ { internalType: "uint256", name: "amountOut", type: "uint256" }, { internalType: "uint256", name: "amountInMax", type: "uint256" }, { internalType: "address[]", name: "path", type: "address[]" }, { internalType: "address", name: "to", type: "address" }, { internalType: "uint256", name: "deadline", type: "uint256" }, ], name: "swapTokensForExactTokens", outputs: [{ internalType: "uint256[]", name: "amounts", type: "uint256[]" }], stateMutability: "nonpayable", type: "function", }, { stateMutability: "payable", type: "receive" }, ];
const WETHABI = [ { constant: true, inputs: [], name: "name", outputs: [{ name: "", type: "string" }], payable: false, stateMutability: "view", type: "function", }, { constant: false, inputs: [ { name: "guy", type: "address" }, { name: "wad", type: "uint256" }, ], name: "approve", outputs: [{ name: "", type: "bool" }], payable: false, stateMutability: "nonpayable", type: "function", }, { constant: true, inputs: [], name: "totalSupply", outputs: [{ name: "", type: "uint256" }], payable: false, stateMutability: "view", type: "function", }, { constant: false, inputs: [ { name: "src", type: "address" }, { name: "dst", type: "address" }, { name: "wad", type: "uint256" }, ], name: "transferFrom", outputs: [{ name: "", type: "bool" }], payable: false, stateMutability: "nonpayable", type: "function", }, { constant: false, inputs: [{ name: "wad", type: "uint256" }], name: "withdraw", outputs: [], payable: false, stateMutability: "nonpayable", type: "function", }, { constant: true, inputs: [], name: "decimals", outputs: [{ name: "", type: "uint8" }], payable: false, stateMutability: "view", type: "function", }, { constant: true, inputs: [{ name: "", type: "address" }], name: "balanceOf", outputs: [{ name: "", type: "uint256" }], payable: false, stateMutability: "view", type: "function", }, { constant: true, inputs: [], name: "symbol", outputs: [{ name: "", type: "string" }], payable: false, stateMutability: "view", type: "function", }, { constant: false, inputs: [ { name: "dst", type: "address" }, { name: "wad", type: "uint256" }, ], name: "transfer", outputs: [{ name: "", type: "bool" }], payable: false, stateMutability: "nonpayable", type: "function", }, { constant: false, inputs: [], name: "deposit", outputs: [], payable: true, stateMutability: "payable", type: "function", }, { constant: true, inputs: [ { name: "", type: "address" }, { name: "", type: "address" }, ], name: "allowance", outputs: [{ name: "", type: "uint256" }], payable: false, stateMutability: "view", type: "function", }, { payable: true, stateMutability: "payable", type: "fallback" }, { anonymous: false, inputs: [ { indexed: true, name: "src", type: "address" }, { indexed: true, name: "guy", type: "address" }, { indexed: false, name: "wad", type: "uint256" }, ], name: "Approval", type: "event", }, { anonymous: false, inputs: [ { indexed: true, name: "src", type: "address" }, { indexed: true, name: "dst", type: "address" }, { indexed: false, name: "wad", type: "uint256" }, ], name: "Transfer", type: "event", }, { anonymous: false, inputs: [ { indexed: true, name: "dst", type: "address" }, { indexed: false, name: "wad", type: "uint256" }, ], name: "Deposit", type: "event", }, { anonymous: false, inputs: [ { indexed: true, name: "src", type: "address" }, { indexed: false, name: "wad", type: "uint256" }, ], name: "Withdrawal", type: "event", }, ];
const UNIFACTORYABI = [ { inputs: [{ internalType: "address", name: "_feeToSetter", type: "address" }], payable: false, stateMutability: "nonpayable", type: "constructor", }, { anonymous: false, inputs: [ { indexed: true, internalType: "address", name: "token0", type: "address" }, { indexed: true, internalType: "address", name: "token1", type: "address" }, { indexed: false, internalType: "address", name: "pair", type: "address" }, { indexed: false, internalType: "uint256", name: "", type: "uint256" }, ], name: "PairCreated", type: "event", }, { constant: true, inputs: [{ internalType: "uint256", name: "", type: "uint256" }], name: "allPairs", outputs: [{ internalType: "address", name: "", type: "address" }], payable: false, stateMutability: "view", type: "function", }, { constant: true, inputs: [], name: "allPairsLength", outputs: [{ internalType: "uint256", name: "", type: "uint256" }], payable: false, stateMutability: "view", type: "function", }, { constant: false, inputs: [ { internalType: "address", name: "tokenA", type: "address" }, { internalType: "address", name: "tokenB", type: "address" }, ], name: "createPair", outputs: [{ internalType: "address", name: "pair", type: "address" }], payable: false, stateMutability: "nonpayable", type: "function", }, { constant: true, inputs: [], name: "feeTo", outputs: [{ internalType: "address", name: "", type: "address" }], payable: false, stateMutability: "view", type: "function", }, { constant: true, inputs: [], name: "feeToSetter", outputs: [{ internalType: "address", name: "", type: "address" }], payable: false, stateMutability: "view", type: "function", }, { constant: true, inputs: [ { internalType: "address", name: "", type: "address" }, { internalType: "address", name: "", type: "address" }, ], name: "getPair", outputs: [{ internalType: "address", name: "", type: "address" }], payable: false, stateMutability: "view", type: "function", }, { constant: false, inputs: [{ internalType: "address", name: "_feeTo", type: "address" }], name: "setFeeTo", outputs: [], payable: false, stateMutability: "nonpayable", type: "function", }, { constant: false, inputs: [{ internalType: "address", name: "_feeToSetter", type: "address" }], name: "setFeeToSetter", outputs: [], payable: false, stateMutability: "nonpayable", type: "function", }, ];
const UNIV2PAIR = [ { inputs: [], payable: false, stateMutability: "nonpayable", type: "constructor" }, { anonymous: false, inputs: [ { indexed: true, internalType: "address", name: "owner", type: "address" }, { indexed: true, internalType: "address", name: "spender", type: "address" }, { indexed: false, internalType: "uint256", name: "value", type: "uint256" }, ], name: "Approval", type: "event", }, { anonymous: false, inputs: [ { indexed: true, internalType: "address", name: "sender", type: "address" }, { indexed: false, internalType: "uint256", name: "amount0", type: "uint256" }, { indexed: false, internalType: "uint256", name: "amount1", type: "uint256" }, { indexed: true, internalType: "address", name: "to", type: "address" }, ], name: "Burn", type: "event", }, { anonymous: false, inputs: [ { indexed: true, internalType: "address", name: "sender", type: "address" }, { indexed: false, internalType: "uint256", name: "amount0", type: "uint256" }, { indexed: false, internalType: "uint256", name: "amount1", type: "uint256" }, ], name: "Mint", type: "event", }, { anonymous: false, inputs: [ { indexed: true, internalType: "address", name: "sender", type: "address" }, { indexed: false, internalType: "uint256", name: "amount0In", type: "uint256" }, { indexed: false, internalType: "uint256", name: "amount1In", type: "uint256" }, { indexed: false, internalType: "uint256", name: "amount0Out", type: "uint256" }, { indexed: false, internalType: "uint256", name: "amount1Out", type: "uint256" }, { indexed: true, internalType: "address", name: "to", type: "address" }, ], name: "Swap", type: "event", }, { anonymous: false, inputs: [ { indexed: false, internalType: "uint112", name: "reserve0", type: "uint112" }, { indexed: false, internalType: "uint112", name: "reserve1", type: "uint112" }, ], name: "Sync", type: "event", }, { anonymous: false, inputs: [ { indexed: true, internalType: "address", name: "from", type: "address" }, { indexed: true, internalType: "address", name: "to", type: "address" }, { indexed: false, internalType: "uint256", name: "value", type: "uint256" }, ], name: "Transfer", type: "event", }, { constant: true, inputs: [], name: "DOMAIN_SEPARATOR", outputs: [{ internalType: "bytes32", name: "", type: "bytes32" }], payable: false, stateMutability: "view", type: "function", }, { constant: true, inputs: [], name: "MINIMUM_LIQUIDITY", outputs: [{ internalType: "uint256", name: "", type: "uint256" }], payable: false, stateMutability: "view", type: "function", }, { constant: true, inputs: [], name: "PERMIT_TYPEHASH", outputs: [{ internalType: "bytes32", name: "", type: "bytes32" }], payable: false, stateMutability: "view", type: "function", }, { constant: true, inputs: [ { internalType: "address", name: "", type: "address" }, { internalType: "address", name: "", type: "address" }, ], name: "allowance", outputs: [{ internalType: "uint256", name: "", type: "uint256" }], payable: false, stateMutability: "view", type: "function", }, { constant: false, inputs: [ { internalType: "address", name: "spender", type: "address" }, { internalType: "uint256", name: "value", type: "uint256" }, ], name: "approve", outputs: [{ internalType: "bool", name: "", type: "bool" }], payable: false, stateMutability: "nonpayable", type: "function", }, { constant: true, inputs: [{ internalType: "address", name: "", type: "address" }], name: "balanceOf", outputs: [{ internalType: "uint256", name: "", type: "uint256" }], payable: false, stateMutability: "view", type: "function", }, { constant: false, inputs: [{ internalType: "address", name: "to", type: "address" }], name: "burn", outputs: [ { internalType: "uint256", name: "amount0", type: "uint256" }, { internalType: "uint256", name: "amount1", type: "uint256" }, ], payable: false, stateMutability: "nonpayable", type: "function", }, { constant: true, inputs: [], name: "decimals", outputs: [{ internalType: "uint8", name: "", type: "uint8" }], payable: false, stateMutability: "view", type: "function", }, { constant: true, inputs: [], name: "factory", outputs: [{ internalType: "address", name: "", type: "address" }], payable: false, stateMutability: "view", type: "function", }, { constant: true, inputs: [], name: "getReserves", outputs: [ { internalType: "uint112", name: "_reserve0", type: "uint112" }, { internalType: "uint112", name: "_reserve1", type: "uint112" }, { internalType: "uint32", name: "_blockTimestampLast", type: "uint32" }, ], payable: false, stateMutability: "view", type: "function", }, { constant: false, inputs: [ { internalType: "address", name: "_token0", type: "address" }, { internalType: "address", name: "_token1", type: "address" }, ], name: "initialize", outputs: [], payable: false, stateMutability: "nonpayable", type: "function", }, { constant: true, inputs: [], name: "kLast", outputs: [{ internalType: "uint256", name: "", type: "uint256" }], payable: false, stateMutability: "view", type: "function", }, { constant: false, inputs: [{ internalType: "address", name: "to", type: "address" }], name: "mint", outputs: [{ internalType: "uint256", name: "liquidity", type: "uint256" }], payable: false, stateMutability: "nonpayable", type: "function", }, { constant: true, inputs: [], name: "name", outputs: [{ internalType: "string", name: "", type: "string" }], payable: false, stateMutability: "view", type: "function", }, { constant: true, inputs: [{ internalType: "address", name: "", type: "address" }], name: "nonces", outputs: [{ internalType: "uint256", name: "", type: "uint256" }], payable: false, stateMutability: "view", type: "function", }, { constant: false, inputs: [ { internalType: "address", name: "owner", type: "address" }, { internalType: "address", name: "spender", type: "address" }, { internalType: "uint256", name: "value", type: "uint256" }, { internalType: "uint256", name: "deadline", type: "uint256" }, { internalType: "uint8", name: "v", type: "uint8" }, { internalType: "bytes32", name: "r", type: "bytes32" }, { internalType: "bytes32", name: "s", type: "bytes32" }, ], name: "permit", outputs: [], payable: false, stateMutability: "nonpayable", type: "function", }, { constant: true, inputs: [], name: "price0CumulativeLast", outputs: [{ internalType: "uint256", name: "", type: "uint256" }], payable: false, stateMutability: "view", type: "function", }, { constant: true, inputs: [], name: "price1CumulativeLast", outputs: [{ internalType: "uint256", name: "", type: "uint256" }], payable: false, stateMutability: "view", type: "function", }, { constant: false, inputs: [{ internalType: "address", name: "to", type: "address" }], name: "skim", outputs: [], payable: false, stateMutability: "nonpayable", type: "function", }, { constant: false, inputs: [ { internalType: "uint256", name: "amount0Out", type: "uint256" }, { internalType: "uint256", name: "amount1Out", type: "uint256" }, { internalType: "address", name: "to", type: "address" }, { internalType: "bytes", name: "data", type: "bytes" }, ], name: "swap", outputs: [], payable: false, stateMutability: "nonpayable", type: "function", }, { constant: true, inputs: [], name: "symbol", outputs: [{ internalType: "string", name: "", type: "string" }], payable: false, stateMutability: "view", type: "function", }, { constant: false, inputs: [], name: "sync", outputs: [], payable: false, stateMutability: "nonpayable", type: "function", }, { constant: true, inputs: [], name: "token0", outputs: [{ internalType: "address", name: "", type: "address" }], payable: false, stateMutability: "view", type: "function", }, { constant: true, inputs: [], name: "token1", outputs: [{ internalType: "address", name: "", type: "address" }], payable: false, stateMutability: "view", type: "function", }, { constant: true, inputs: [], name: "totalSupply", outputs: [{ internalType: "uint256", name: "", type: "uint256" }], payable: false, stateMutability: "view", type: "function", }, { constant: false, inputs: [ { internalType: "address", name: "to", type: "address" }, { internalType: "uint256", name: "value", type: "uint256" }, ], name: "transfer", outputs: [{ internalType: "bool", name: "", type: "bool" }], payable: false, stateMutability: "nonpayable", type: "function", }, { constant: false, inputs: [ { internalType: "address", name: "from", type: "address" }, { internalType: "address", name: "to", type: "address" }, { internalType: "uint256", name: "value", type: "uint256" }, ], name: "transferFrom", outputs: [{ internalType: "bool", name: "", type: "bool" }], payable: false, stateMutability: "nonpayable", type: "function", }, ];

async function main() {
  console.log("-------------- Deployment Start --------------");
  // await run("compile");

  const accounts = await ethers.getSigners();
  // required contracts' addresses
  // TODO: currently set for Rinkeby testnet. should be changed for different chain
  const UNISWAP_ROUTER_ADDRESS = "0x7a250d5630b4cf539739df2c5dacb4c659f2488d";
  const UNISWAP_FACTORY_ADDRESS = "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f";
  const SUSHISWAP_ROUTER_ADDRESS = "0xd9e1ce17f2641f24ae83637ab66a2cca9c378b9f";
  const BALANCER_V2_PROXY_ADDRESS = "0x3e66b66fd1d0b02fda6c811da9e0547970db2f21";
  const PRE_ISSUE_HOOK = "0x0000000000000000000000000000000000000000";

  // Tokens
  const WBTC_MAIN = "0xaea6d1d92173e3ee50c4cc02fa78bf0de625be61";  
  const WETH_MAIN = "0x07e26e13402d7e38f81f763bbaa410f70187daf8";  
  const USDT_MAIN = "0xc673b2caca98e4e6f5f1e9b4fd0a2d71e2aa2f0f";  
  const UNI_MAIN = "0x33fb3e1ff375e6ede0590b1784472e8a25f7d747";  
  const AAVE_MAIN = "0x29f610792288d85620d056c3648ea2f172b09ef0";  
  const COMP_MAIN = "0xdfbafe2359b89d9086107883fad69f3b642bfbe5";  
  const SUSHI_MAIN = "0x02e3fcdfcf86c3800e8c02e85072432592de1f16";  
  const MAKER_MAIN = "0x11f457f34e1b29f92b0dec095aa31ad3eb906b86";  
  const LINK_MAIN = "0x387bbe838f627c35728858fa9ce846ef964ba2c3";  
  const DAI_MAIN = "0x656e1146795810cba2bf8cafa91c3f43f2abb43f";  
  const USDC_MAIN = "0x2100d46a96fb3c5adbf2ef33b3f586b7329c2fef"; 

  // CK tokens
  const CKTokens = [
    {
      components: [WBTC_MAIN, WETH_MAIN, UNI_MAIN, LINK_MAIN, AAVE_MAIN],
      units: [
        "116277",
        "7214773949061120",
        "32423764681186600",
        "26545042754428400",
        "793661190355337",
      ],
      name: "Cook ETH Major",
      symbol: "CEM",
      address: "0x0",
    },
    {
      components: [USDT_MAIN, DAI_MAIN, USDC_MAIN],
      units: ["333333",  "333333333333333333",  "333333"],
      name: "Cook Stable Index",
      symbol: "CSI",
      address: "0x0",
    },
    {
      components: [UNI_MAIN, LINK_MAIN, AAVE_MAIN, COMP_MAIN, MAKER_MAIN, SUSHI_MAIN],
      units: [
        "902259372402087000",
        "736255903415051000",
        "22137631206266900",
        "8879004272980990",
        "1588779249974350",
        "290082997926716000",
      ],
      name: "Cook ETH MAIN",
      symbol: "CEM",
      address: "0x0",
    },
  ];

  /**
   * deploy controller
   *
   * params -
   * feeRecipient: address
   */
  const cookProtocolDeployer = accounts[0];
  const Controller = await ethers.getContractFactory("Controller");
  const controller = await Controller.deploy(cookProtocolDeployer.address);
  await controller.deployed();
  console.log("controller address:", controller.address);

  /**
   * deploy CKTokenCreator
   *
   * params -
   * controller: IController
   */

  const CKTokenCreator = await ethers.getContractFactory("CKTokenCreator");
  const ckTokenCreator = await CKTokenCreator.deploy(controller.address);
  await ckTokenCreator.deployed();
  console.log("ckTokenCreator address:", ckTokenCreator.address);

  /**
   * deploy IntegrationRegistry
   *
   * params -
   * controller: IController
   */

  const IntegrationRegistry = await ethers.getContractFactory("IntegrationRegistry");
  const integrationRegistry = await IntegrationRegistry.deploy(controller.address);
  await integrationRegistry.deployed();
  console.log("integrationRegistry address:", integrationRegistry.address);

  /**
   * deploy StreamingFeeModule
   *
   * params -
   * controller: IController
   */

  const StreamingFeeModule = await ethers.getContractFactory("StreamingFeeModule");
  const streamingFeeModule = await StreamingFeeModule.deploy(controller.address);
  await streamingFeeModule.deployed();
  console.log("streamingFeeModule address:", streamingFeeModule.address);

  /**
   * deploy BasicIssuanceModule
   *
   * params -
   * controller: IController
   */

  const BasicIssuanceModule = await ethers.getContractFactory("BasicIssuanceModule");
  const basicIssuanceModule = await BasicIssuanceModule.deploy(controller.address);
  await basicIssuanceModule.deployed();
  console.log("basicIssuanceModule address:", basicIssuanceModule.address);

  /**
   * deploy WrapModule
   *
   * params -
   * controller: IController
   */

  const WrapModule = await ethers.getContractFactory("WrapModule");
  const wrapModule = await WrapModule.deploy(controller.address, WETH_MAIN);
  await wrapModule.deployed();
  console.log("wrapModule address:", wrapModule.address);

  /**
   * deploy TradeModule
   *
   * params -
   * controller: IController
   */

  const TradeModule = await ethers.getContractFactory("TradeModule");
  const tradeModule = await TradeModule.deploy(controller.address);
  await tradeModule.deployed();
  console.log("tradeModule address:", tradeModule.address);

  /**
   * deploy GovernanceModule
   *
   * params -
   * controller: IController
   */

  const GovernanceModule = await ethers.getContractFactory("GovernanceModule");
  const governanceModule = await GovernanceModule.deploy(controller.address);
  await governanceModule.deployed();
  console.log("governanceModule address:", governanceModule.address);

  /**
   * Deploy GeneralIndexModule
   */
  
  const GeneralIndexModule = await ethers.getContractFactory("GeneralIndexModule");
  const generalIndexModule = await GeneralIndexModule.deploy(controller.address, WETH_MAIN);
  await generalIndexModule.deployed();
  console.log("generalIndexModule address:", generalIndexModule.address);  

  /**
   * initialize Controller
   *
   * params -
   * factories: address[]
   * modules: address[]
   * resources: address[]
   * resourceIds: address[]
   */
  const controllerInitialized = await controller.initialize(
    [ckTokenCreator.address],
    [
      streamingFeeModule.address,
      basicIssuanceModule.address,
      wrapModule.address,
      tradeModule.address,
      governanceModule.address,
      generalIndexModule.address,
    ],
    [integrationRegistry.address],
    [0],
  );
  await controllerInitialized.wait();
  console.log("controller initialized:", !!controllerInitialized);

  /**
   * Create CKTokens through CKTokenCreator
   *
   * params -
   * components: address[]
   * units: int256[]
   * modules: address[]
   * manager: address
   * name: string
   * symbol: string
   */
  for (var i = 0; i < CKTokens.length; i++) {
    /**
     * deploy SingleIndexModule for each index
     *
     * params -
     * controller: IController
     */

    var ckTokenCreated: ContractTransaction = await ckTokenCreator.create(
      CKTokens[i].components,
      CKTokens[i].units,
      [
        streamingFeeModule.address,
        basicIssuanceModule.address,
        wrapModule.address,
        tradeModule.address,
        generalIndexModule.address,
        governanceModule.address,
      ],
      cookProtocolDeployer.address,
      CKTokens[i].name,
      CKTokens[i].symbol,
    );

    await ckTokenCreated.wait();

    var retrievedCKAddress = await new ProtocolUtils(ethers.provider).getCreatedCKTokenAddress(
      ckTokenCreated.hash,
    );
    var ckToken = new CKToken__factory(cookProtocolDeployer).attach(retrievedCKAddress);
    console.log("ckToken %s address: %s", CKTokens[i].symbol, ckToken.address);
    CKTokens[i].address = retrievedCKAddress;

    /**
     * initialize StreamingFeeModule
     *
     * params -
     * ckToken: ICKToken
     * settings: FeeState
     */

    var streamingFeeModuleInitialized = await streamingFeeModule.initialize(ckToken.address, {
      feeRecipient: cookProtocolDeployer.address,
      maxStreamingFeePercentage: "50000000000000000", // 5%
      streamingFeePercentage: "9500000000000000", // 0.95%
      lastStreamingFeeTimestamp: 0,
    });
    await streamingFeeModuleInitialized.wait();
    console.log("streamingFeeModule initialized:", !!streamingFeeModuleInitialized);

    /**
     * initialize BasicIssuanceModule
     *
     * params -
     * ckToken: ICKToken
     * preIssueHook: IManagerIssuanceHook
     */
    var basicIssuanceModuleInitialized = await basicIssuanceModule.initialize(
      ckToken.address,
      PRE_ISSUE_HOOK,
    );
    await basicIssuanceModuleInitialized.wait();
    console.log("basicIssuanceModule initialized:", !!basicIssuanceModuleInitialized);

    /**
     * initialize TradeModule
     *
     * params -
     * ckToken: ICKToken
     */
    var tradeModuleInitialized = await tradeModule.initialize(ckToken.address);
    await tradeModuleInitialized.wait();
    console.log("tradeModule initialized:", !!tradeModuleInitialized);

    /**
     * initialize GeneralIndexModule
     *
     * params -
     * ckToken: ICKToken
     */
    var generalIndexModuleInitialized = await generalIndexModule.initialize(ckToken.address);
    await generalIndexModuleInitialized.wait();
    console.log("singleIndexModule initialized:", !!generalIndexModuleInitialized);

    /**
     * initialize WrapModule
     *
     * params -
     * ckToken: ICKToken
     */
    var wrapModuleInitialized = await wrapModule.initialize(ckToken.address);
    await wrapModuleInitialized.wait();
    console.log("wrapModule initialized:", !!wrapModuleInitialized);

    /**
     * initialize GovernanceModule
     *
     * params -
     * ckToken: ICKToken
     */
    const governanceModuleInitialized = await governanceModule.initialize(ckToken.address);
    await governanceModuleInitialized.wait();
    console.log("governanceModule initialized:", !!governanceModuleInitialized);
  }

  console.log("------------- Deployment Completed ------------");

//   let overrides = {
//     value: ethers.utils.parseEther("1000"),
//     gasLimit: 600000,
//   };

  var tokens_to_mint = [
    WETH_MAIN,
    UNI_MAIN,
    AAVE_MAIN,
    COMP_MAIN,
    SUSHI_MAIN,
    MAKER_MAIN,
    LINK_MAIN,
    DAI_MAIN,
  ];
  for (var i = 0; i < tokens_to_mint.length; i++) {
    const erc20 = await ethers.getContractAt(ERC20ABI, tokens_to_mint[i]);
    await erc20.connect(cookProtocolDeployer).mint(cookProtocolDeployer.address, "100000000000000000000");
    // await erc20.connect(cookProtocolDeployer).approve(basicIssuanceModule.address, "10000000000000000000000000");
    console.log("minted: ", await erc20.connect(cookProtocolDeployer).symbol());
    // console.log((await erc20.connect(uniswap_creator).allowance(uniswap_creator.address, basicIssuanceModule.address)).toString());
  }

  const mockWBTC = await ethers.getContractAt(ERC20ABI, WBTC_MAIN);
  await mockWBTC.connect(cookProtocolDeployer).mint(cookProtocolDeployer.address, "10000000000");
  console.log("WBTC")

  const mockUSDT = await ethers.getContractAt(ERC20ABI, USDT_MAIN);
  await mockUSDT.connect(cookProtocolDeployer).mint(cookProtocolDeployer.address, "100000000");
  console.log("USDT");
  const mockUSDC = await ethers.getContractAt(ERC20ABI, USDC_MAIN);
  await mockUSDC.connect(cookProtocolDeployer).mint(cookProtocolDeployer.address, "100000000");    
  console.log("USDC");

  console.log("------------- Mint tokens Completed ------------");

  console.log("------------- Issue CkTokens for account[0] --------------");

  const issue_amoount = "12000000000000000000";

  for (var i = 0; i < CKTokens.length; i++) {


    await basicIssuanceModule.connect(cookProtocolDeployer).issue(CKTokens[i].address, issue_amoount, cookProtocolDeployer.address);
    console.log("--------issued ck token successfully --------");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
