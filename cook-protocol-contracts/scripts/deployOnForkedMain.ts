import { ethers } from "hardhat";
import { ContractTransaction } from "ethers";
import { ProtocolUtils } from "../utils/common";
import { CKToken__factory } from "../typechain/factories/CKToken__factory";
import BigNumber from "bignumber.js";

const ERC20ABI = [ { constant: true, inputs: [], name: "name", outputs: [{ name: "", type: "string" }], payable: false, stateMutability: "view", type: "function", }, { constant: false, inputs: [ { name: "_spender", type: "address" }, { name: "_value", type: "uint256" }, ], name: "approve", outputs: [{ name: "", type: "bool" }], payable: false, stateMutability: "nonpayable", type: "function", }, { constant: true, inputs: [], name: "totalSupply", outputs: [{ name: "", type: "uint256" }], payable: false, stateMutability: "view", type: "function", }, { constant: false, inputs: [ { name: "_from", type: "address" }, { name: "_to", type: "address" }, { name: "_value", type: "uint256" }, ], name: "transferFrom", outputs: [{ name: "", type: "bool" }], payable: false, stateMutability: "nonpayable", type: "function", }, { constant: true, inputs: [], name: "decimals", outputs: [{ name: "", type: "uint8" }], payable: false, stateMutability: "view", type: "function", }, { constant: true, inputs: [{ name: "_owner", type: "address" }], name: "balanceOf", outputs: [{ name: "balance", type: "uint256" }], payable: false, stateMutability: "view", type: "function", }, { constant: true, inputs: [], name: "symbol", outputs: [{ name: "", type: "string" }], payable: false, stateMutability: "view", type: "function", }, { constant: false, inputs: [ { name: "_to", type: "address" }, { name: "_value", type: "uint256" }, ], name: "transfer", outputs: [{ name: "", type: "bool" }], payable: false, stateMutability: "nonpayable", type: "function", }, { constant: true, inputs: [ { name: "_owner", type: "address" }, { name: "_spender", type: "address" }, ], name: "allowance", outputs: [{ name: "", type: "uint256" }], payable: false, stateMutability: "view", type: "function", }, { payable: true, stateMutability: "payable", type: "fallback" }, { anonymous: false, inputs: [ { indexed: true, name: "owner", type: "address" }, { indexed: true, name: "spender", type: "address" }, { indexed: false, name: "value", type: "uint256" }, ], name: "Approval", type: "event", }, { anonymous: false, inputs: [ { indexed: true, name: "from", type: "address" }, { indexed: true, name: "to", type: "address" }, { indexed: false, name: "value", type: "uint256" }, ], name: "Transfer", type: "event", }, ];
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
  const WETH_ADDRESS = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
  const UNISWAP_ROUTER_ADDRESS = "0x7a250d5630b4cf539739df2c5dacb4c659f2488d";
  const UNISWAP_FACTORY_ADDRESS = "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f";
  const SUSHISWAP_ROUTER_ADDRESS = "0xd9e1ce17f2641f24ae83637ab66a2cca9c378b9f";
  const BALANCER_V2_PROXY_ADDRESS = "0x3e66b66fd1d0b02fda6c811da9e0547970db2f21";
  const PRE_ISSUE_HOOK = "0x0000000000000000000000000000000000000000";

  // Tokens
  const WBTC_MAIN = "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599";
  const WETH_MAIN = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
  const USDT_MAIN = "0xdac17f958d2ee523a2206206994597c13d831ec7";
  const UNI_MAIN = "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984";
  const AAVE_MAIN = "0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9";
  const COMP_MAIN = "0xc00e94cb662c3520282e6f5717214004a7f26888";
  const YFI_MAIN = "0x0bc529c00c6401aef6d220be8c6ea1667f6ad93e";
  const SUSHI_MAIN = "0x6b3595068778dd592e39a122f4f5a5cf09c90fe2";

  // CK tokens
  const CKTokens = [
    {
      components: [WBTC_MAIN, WETH_MAIN, AAVE_MAIN],
      units: ["5000000", "1000000000000000000", "2500000000000000000"],
      name: "Cook BTC ETC AAVE MAKER",
      symbol: "Cook BEAM",
      address: "0x0"
    },
    {
      components: [WBTC_MAIN, COMP_MAIN, YFI_MAIN, USDT_MAIN],
      units: ["5000000", "6100000000000000000", "100000000000000000", "300000000000"],
      name: "Cook BTC COMP YFI USDT",
      symbol: "Cook BCYU",
      address: "0x0"
    },
    {
      components: [UNI_MAIN, SUSHI_MAIN, AAVE_MAIN, WETH_MAIN],
      units: ["10000000000000000000", "25600000000000000000", "1110000000000000000", "204500000000000000",],
      name: "Cook UNI SUSHI AAVE ETH",
      symbol: "Cook USAE",
      address: "0x0"
    },
  ];

  const uniswapRouterV2 = await ethers.getContractAt(UNIV2RouterABI, UNISWAP_ROUTER_ADDRESS);
  const uniswapFactory = await ethers.getContractAt(UNIFACTORYABI, UNISWAP_FACTORY_ADDRESS);
  const wETH = await ethers.getContractAt(WETHABI, WETH_MAIN);

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
  const wrapModule = await WrapModule.deploy(controller.address, WETH_ADDRESS);
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

    const SingleIndexModule = await ethers.getContractFactory("SingleIndexModule");
    const singleIndexModule = await SingleIndexModule.deploy(
      controller.address,
      WETH_ADDRESS,
      UNISWAP_ROUTER_ADDRESS,
      SUSHISWAP_ROUTER_ADDRESS,
      BALANCER_V2_PROXY_ADDRESS,
    );
    await singleIndexModule.deployed();
    await controller.addModule(singleIndexModule.address);
    console.log("singleIndexModule address:", singleIndexModule.address);

    var ckTokenCreated: ContractTransaction = await ckTokenCreator.create(
      CKTokens[i].components,
      CKTokens[i].units,
      [
        streamingFeeModule.address,
        basicIssuanceModule.address,
        wrapModule.address,
        tradeModule.address,
        singleIndexModule.address,
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
     * initialize SingleIndexModule
     *
     * params -
     * ckToken: ICKToken
     */
    var singleIndexModuleInitialized = await singleIndexModule.initialize(ckToken.address);
    await singleIndexModuleInitialized.wait();
    console.log("singleIndexModule initialized:", !!singleIndexModuleInitialized);

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

  let overrides = {
    value: ethers.utils.parseEther("10000"),
    gasLimit: 600000,
  };

    // const WBTC_MAIN = "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599";
    // const WETH_MAIN = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
    // const USDT_MAIN = "0xdac17f958d2ee523a2206206994597c13d831ec7";
    // const UNI_MAIN = "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984";
    // const AAVE_MAIN = "0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9";
    // const COMP_MAIN = "0xc00e94cb662c3520282e6f5717214004a7f26888";
    // const YFI_MAIN = "0x0bc529c00c6401aef6d220be8c6ea1667f6ad93e";
    // const SUSHI_MAIN = "0x6b3595068778dd592e39a122f4f5a5cf09c90fe2";
  console.log("------------- Start Swapping tokens for account[0] and account[1] ------------");

  const uniswap_creator = accounts[1];

  var tokens_to_swap = [WBTC_MAIN, USDT_MAIN, UNI_MAIN, AAVE_MAIN, COMP_MAIN, YFI_MAIN, SUSHI_MAIN];
  for (var i = 0; i < tokens_to_swap.length; i++) {
    await uniswapRouterV2.connect(cookProtocolDeployer).swapExactETHForTokens(0, [WETH_MAIN, tokens_to_swap[i]], cookProtocolDeployer.address, Date.now() * 2, overrides);
    await uniswapRouterV2.connect(uniswap_creator).swapExactETHForTokens(0, [WETH_MAIN, tokens_to_swap[i]], uniswap_creator.address, Date.now() * 2, overrides);
    
    const erc20 = await ethers.getContractAt(ERC20ABI, tokens_to_swap[i]);
    await erc20.connect(uniswap_creator).approve(basicIssuanceModule.address, "10000000000000000000000000");
    // console.log((await erc20.connect(uniswap_creator).allowance(uniswap_creator.address, basicIssuanceModule.address)).toString());
  }
  await wETH.connect(cookProtocolDeployer).deposit(overrides);
  await wETH.connect(uniswap_creator).deposit(overrides);
  await wETH.connect(uniswap_creator).approve(basicIssuanceModule.address, "10000000000000000000000000")

  console.log("------------- Swap tokens Completed ------------");


  console.log("------------- Issue CkTokens for account[1] --------------");

  const issue_amoount = "20000000000000000000";

  for (var i = 0; i < CKTokens.length; i++) {

    // for (var j = 0; j < CKTokens[i].components.length; j++) {
    //   const requiredToken = await ethers.getContractAt(ERC20ABI, CKTokens[i].components[j]);
    //   const cur_balance = await requiredToken
    //     .connect(uniswap_creator)
    //     .balanceOf(uniswap_creator.address);
    //   console.log(`%s: `, CKTokens[i].components[j], cur_balance.toString());
    //   console.log(CKTokens[i].units[j]);
    // }

    await basicIssuanceModule.connect(uniswap_creator).issue(CKTokens[i].address, issue_amoount, uniswap_creator.address);


    // const ckToken = await ethers.getContractAt(ERC20ABI, CKTokens[i].address);
    // console.log((await ckToken.connect(uniswap_creator).balanceOf(uniswap_creator.address)).toString());
    await uniswapFactory.connect(uniswap_creator).createPair(CKTokens[i].address, WETH_MAIN);
    console.log("-------- pair created -----------");
    // console.log(CKTokens[i].address);
    const ckTokenErc20 = await ethers.getContractAt(ERC20ABI, CKTokens[i].address);
    await wETH.connect(uniswap_creator).approve(uniswapRouterV2.address, "10000000000000000000000000");
    await ckTokenErc20.connect(uniswap_creator).approve(uniswapRouterV2.address, "10000000000000000000000000");
    await uniswapRouterV2.connect(uniswap_creator).addLiquidity(CKTokens[i].address, WETH_MAIN,
      "10000000000000000000",
      "10000000000000000000",
      "1000",
      "1000",
      uniswap_creator.address,
      Date.now() * 2,
    );
    const pairAddress = await uniswapFactory.connect(uniswap_creator).getPair(CKTokens[i].address, WETH_MAIN)

    console.log(`%s liquidity pool:`, CKTokens[i].name, pairAddress);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
