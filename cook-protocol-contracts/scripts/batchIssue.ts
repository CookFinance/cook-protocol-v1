import { ethers } from "hardhat";
import axios from "axios";
import { BatchIssuanceModule__factory } from "../typechain/factories/BatchIssuanceModule__factory";

let intervalObj: NodeJS.Timeout;
let batchIssueDone: boolean = false;

async function main() {
  try {
    console.log('-------------- Detecting, please wait --------------');
    intervalObj = setInterval(intervalBatchIssue, 60000);
  } catch (error) {
    console.log('batch issue error: ', error);
  }
}

async function intervalBatchIssue() {
  try {
    /**
     * detect if rounds are ready to do batch and do the batch issue based on gas fee 
     */

    const accounts = await ethers.getSigners();
    // TODO: currently set for Rinkeby testnet. should be changed for different chain
    const GOOD_GAS_PRICE = 30; // gas price will be good if it's below GOOD_GAS_PRICE
    const BATCH_ISSUANCE_MODULE = '0x29CE87c024f649fed58Ef68A361913bf44e5Caa5';

    // contracts
    const batchIssuanceModule = new BatchIssuanceModule__factory(accounts[0]).attach(BATCH_ISSUANCE_MODULE);

    const rawRoundsToBake = await batchIssuanceModule.getRoundsToBake();
    if (rawRoundsToBake.length > 3) {
      const roundsToBake = [];
      for (let i = 0; i < rawRoundsToBake.length - 1; i++) {
        const roundIndex = rawRoundsToBake[i].toNumber();
        roundsToBake.push(roundIndex);
      }

      const gasPrice = await fetchGasPrice();
      if (gasPrice < GOOD_GAS_PRICE) {
        if (intervalObj) clearInterval(intervalObj);
        const txBatchIssue = await batchIssuanceModule.batchIssue(roundsToBake);
        await txBatchIssue.wait();
        batchIssueDone = true;
        console.log('---------- Congrats! Batch Issue Done ----------');
      }
    }
  } catch (error) {
    console.log('interval batch issue error: ', error);
  }
}

async function fetchGasPrice() {
  const URL = `https://ethgasstation.info/api/ethgasAPI.json?api-key=${process.env.ETH_GAS_API_KEY}`;
  try {
    const response = await axios.get(URL)
    const gasPriceNow = await response.data.average/10; // in gwei
    return(gasPriceNow);
  } catch(e){
    throw Error(e);
  }
}

main()
  .then(() => {
    if (batchIssueDone) process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
