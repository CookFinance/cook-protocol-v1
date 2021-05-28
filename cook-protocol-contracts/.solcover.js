const shell = require("shelljs"); // This module is already a solidity-coverage dep

module.exports = {
  skipFiles: ["mocks", "interfaces", "product/AssetLimitHook.sol", "protocol-viewers"],
  providerOptions: {
    default_balance_ether: 100000000,
    gasLimit: 30000000,
  },
};
