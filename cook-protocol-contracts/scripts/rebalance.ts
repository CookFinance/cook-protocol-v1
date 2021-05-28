import { ethers } from "hardhat";
import { ContractTransaction } from "ethers";
import { BigNumber } from "@ethersproject/bignumber";
import { ether } from "../utils/index";
import { CKToken__factory } from "../typechain/factories/CKToken__factory";
import { SingleIndexModule__factory } from "../typechain/factories/SingleIndexModule__factory";
import { StreamingFeeModule__factory } from "../typechain/factories/StreamingFeeModule__factory";
import { BasicIssuanceModule__factory } from "../typechain/factories/BasicIssuanceModule__factory";

async function main() {
  try {
    console.log('-------------- Rebalancing Start --------------');

    // constants
    const TEN_MINUTES = 600; // in seconds
    const COOL_PERIOD = BigNumber.from(TEN_MINUTES); // ten minutes

    const accounts = await ethers.getSigners();
    // required contracts' addresses
    // TODO: currently set for Rinkeby testnet. should be changed for different chain
    // index and module
    const CK_TOKEN = '0xa1Ea5EAf5009f944D1da771C78981c6Fd09bE4eF';
    const SINGLE_INDEX_MODULE = '0xBA80E2495e728af03FD69C77C4C130FC5Ad84F8b';
    const STREAMING_FEE_MODULE = '0x3381545476B5396049785B0E10f3078973DabD1c';
    const BASIC_ISSUANCE_MODULE = '0xaCD8ef35aF33ce89920b00F1852e06f0029c75F9';
    
    // contracts
    const ckToken = new CKToken__factory(accounts[0]).attach(CK_TOKEN);
    const indexModule = new SingleIndexModule__factory(accounts[0]).attach(SINGLE_INDEX_MODULE);
    const streamingFeeModule = new StreamingFeeModule__factory(accounts[0]).attach(STREAMING_FEE_MODULE);
    const basicIssuanceModule = new BasicIssuanceModule__factory(accounts[0]).attach(BASIC_ISSUANCE_MODULE);

    // underlying assets
    const components = await ckToken.getComponents();

    /* rebalance configuration - begin */
    // set trade maximum limit for each component
    const tradeMaximums = [ether(100), ether(200), ether(300)];
    await indexModule.setTradeMaximums(components, tradeMaximums);
    console.log('1. setTradeMaximums(DONE): ', tradeMaximums);

    // for each component, set exchange id to be used for rebalancing trade. Below all three exchanges are uniswap id(1)
    const exchanges = [1, 1, 1];
    await indexModule.setExchanges(components, exchanges);
    console.log('2. setExchanges(DONE): ', exchanges);

    // set cool off period between trades of each component
    const coolOffPeriod = [COOL_PERIOD, COOL_PERIOD, COOL_PERIOD];
    await indexModule.setCoolOffPeriods(components, coolOffPeriod);
    console.log('3. setCoolOffPeriods(DONE): ', coolOffPeriod);

    // set whitelist trader
    const whitelistedTraders = [accounts[0].address];
    await indexModule.updateTraderStatus(whitelistedTraders, [true]);
    console.log('4. updateTraderStatus(DONE): ', whitelistedTraders);
    /* rebalance configuration - end */

    // start rebalancing
    const targetUnits = [ether(40), ether(40), ether(20)];
    await indexModule.startRebalance([], [], targetUnits, await ckToken.positionMultiplier());

    console.log('5. rebalancing... ');
    const realTargetUnits = await indexModule.getTargetUnits(components);

    for (let i = 0; i < components.length; i++) {

      const realUnit = realTargetUnits[i];
      const currentUnit = await ckToken.getDefaultPositionRealUnit(components[i]);

      while(realUnit != currentUnit) {

        // execute trade for each component until the target unit meet
        await indexModule.trade(components[0]);

        // wait for COOL off period
        await delay(TEN_MINUTES*1000);

      }

      console.log(`component(${components[i]}) rebalance done!`)
    }

    console.log('------------ Rebalancing Completed ------------');
  } catch (error) {
    console.log('rebalancing error: ', error);
  }
  
}

const delay = (ms) => new Promise(res => setTimeout(res, ms));

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
