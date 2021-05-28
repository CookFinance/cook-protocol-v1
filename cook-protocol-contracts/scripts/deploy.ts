import { ethers } from "hardhat";
import { ContractTransaction } from "ethers";
import { ProtocolUtils } from "../utils/common";
import { CKToken__factory } from "../typechain/factories/CKToken__factory";



async function main() {
  console.log('-------------- Deployment Start --------------');
  // await run("compile");

  const accounts = await ethers.getSigners();
  // required contracts' addresses
  // TODO: currently set for Rinkeby testnet. should be changed for different chain
  const WHT_ADDRESS = '0xc778417e063141139fce010982780140aa0cd5ab';
  const UNISWAP_ROUTER = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D';
  const SUSHISWAP_ROUTER = '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506';
  const BALANCER_PROXY = "0x8b6081975B146B599A71CD7D28f877B811183bcb";
  const TOKEN_1 = '0xCC9308318B91528a8a4573Db77E9Abfa1Fc85224';
  const TOKEN_2 = '0x7c7F0428238815492194c2AFC30cf186CfC67dcb';
  const TOKEN_3 = '0x5939F1B2999edF416A4A9Ab067AF2CC5eC1D9BBD';
  const CK_TOKEN_NAME = 'New Index';
  const CK_TOKEN_SYMBOL = 'NEW';
  const PRE_ISSUE_HOOK = '0x0000000000000000000000000000000000000000';

  for (var i = 0; i < accounts.length; i++) {
    console.log("User address to be used:", accounts[i].address);
  }
  
  /**
   * deploy controller
   * 
   * params -
   * feeRecipient: address
   */ 
  const Controller = await ethers.getContractFactory("Controller");
  const protocolFeeRecipient = accounts[0].address;
  const controller = await Controller.deploy(protocolFeeRecipient);
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
  const wrapModule = await WrapModule.deploy(controller.address, WHT_ADDRESS);
  await wrapModule.deployed();
  console.log("wrapModule address:", wrapModule.address);

  /**
   * deploy SingleIndexModule
   * 
   * params -
   * controller: IController
   */ 
  const SingleIndexModule = await ethers.getContractFactory("SingleIndexModule");
  const singleIndexModule = await SingleIndexModule.deploy(controller.address, WHT_ADDRESS, UNISWAP_ROUTER, SUSHISWAP_ROUTER, BALANCER_PROXY);
  await singleIndexModule.deployed();
  console.log("singleIndexModule address:", singleIndexModule.address);

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
      singleIndexModule.address,
      governanceModule.address
    ],
    [integrationRegistry.address],
    [0]
  );
  await controllerInitialized.wait();
  console.log("controller initialized:", !!controllerInitialized);

  /**
   * Create CKToken through CKTokenCreator
   * 
   * params -
   * components: address[]
   * units: int256[]
   * modules: address[]
   * manager: address
   * name: string
   * symbol: string
   */
  const manager = accounts[0].address;
  const ckTokenCreated: ContractTransaction = await ckTokenCreator.create(
    [TOKEN_1, TOKEN_2, TOKEN_3],
    ['50000000000000000000', '30000000000000000000', '20000000000000000000'],
    [
      streamingFeeModule.address,
      basicIssuanceModule.address,
      wrapModule.address,
      tradeModule.address,
      singleIndexModule.address,
      governanceModule.address
    ],
    manager,
    CK_TOKEN_NAME,
    CK_TOKEN_SYMBOL
  );
  await ckTokenCreated.wait();
  const retrievedCKAddress = await new ProtocolUtils(ethers.provider).getCreatedCKTokenAddress(ckTokenCreated.hash);
  const ckToken = new CKToken__factory(accounts[0]).attach(retrievedCKAddress);
  console.log("ckToken address:", ckToken.address);

  /**
   * initialize StreamingFeeModule
   * 
   * params -
   * ckToken: ICKToken
   * settings: FeeState
   */
  const indexFeeRecipient = accounts[0].address;
  const streamingFeeModuleInitialized = await streamingFeeModule.initialize(
    ckToken.address,
    {
      feeRecipient: indexFeeRecipient,
      maxStreamingFeePercentage: "50000000000000000", // 5%
      streamingFeePercentage: "9500000000000000", // 0.95%
      lastStreamingFeeTimestamp: 0
    }
  );
  await streamingFeeModuleInitialized.wait();
  console.log("streamingFeeModule initialized:", !!streamingFeeModuleInitialized);

  /**
   * initialize BasicIssuanceModule
   * 
   * params -
   * ckToken: ICKToken
   * preIssueHook: IManagerIssuanceHook
   */
  const basicIssuanceModuleInitialized = await basicIssuanceModule.initialize(
    ckToken.address,
    PRE_ISSUE_HOOK
  );
  await basicIssuanceModuleInitialized.wait();
  console.log("basicIssuanceModule initialized:", !!basicIssuanceModuleInitialized);

  /**
   * initialize TradeModule
   * 
   * params -
   * ckToken: ICKToken
   */
  const tradeModuleInitialized = await tradeModule.initialize(ckToken.address);
  await tradeModuleInitialized.wait();
  console.log("tradeModule initialized:", !!tradeModuleInitialized);

  /**
   * initialize SingleIndexModule
   * 
   * params -
   * ckToken: ICKToken
   */
  const singleIndexModuleInitialized = await singleIndexModule.initialize(ckToken.address);
  await singleIndexModuleInitialized.wait();
  console.log("singleIndexModule initialized:", !!singleIndexModuleInitialized);

  /**
   * initialize WrapModule
   * 
   * params -
   * ckToken: ICKToken
   */
  const wrapModuleInitialized = await wrapModule.initialize(ckToken.address);
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

  console.log('------------- Deployment Completed ------------');
}

// Now trying to swap ETH for WETH
console.log("user ETH balance:", )


main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
