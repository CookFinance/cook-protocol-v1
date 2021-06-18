import { ethers } from "hardhat";
import { ContractTransaction } from "ethers";
import { ether } from "../utils/index";
import { ProtocolUtils } from "../utils/common";
import { BatchIssuanceSetting } from "../utils/types";
import { CKToken__factory } from "../typechain/factories/CKToken__factory";



async function main() {
  console.log('-------------- Deployment Start --------------');
  // await run("compile");

  const accounts = await ethers.getSigners();
  // required contracts' addresses
  // TODO: currently set for Rinkeby testnet. should be changed for different chain
  const WETH_ADDRESS = '0xc778417e063141139fce010982780140aa0cd5ab';
  const UNISWAP_FACTORY = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D';
  const UNISWAP_ROUTER = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D';
  const SUSHISWAP_ROUTER = '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506';
  const BALANCER_PROXY = "0x8b6081975B146B599A71CD7D28f877B811183bcb";
  const UNISWAP_ADAPTER_NAME = 'UNISWAP';
  const SUSHISWAP_ADAPTER_NAME = 'SUSHISWAP';
  const BALANCER_ADAPTER_NAME = 'BALANCER';
  const TOKEN_1 = '0xCC9308318B91528a8a4573Db77E9Abfa1Fc85224';
  const TOKEN_2 = '0x7c7F0428238815492194c2AFC30cf186CfC67dcb';
  const TOKEN_3 = '0x5939F1B2999edF416A4A9Ab067AF2CC5eC1D9BBD';
  const UNI_TOKEN1_WETH_PAIR = '0xD2Dc6b8284b58D236f26db7DB04b0445b22E3051';
  const UNI_TOKEN2_WETH_PAIR = '0x6b542Adad328d097073E0E5555B32f4dc90DdE26';
  const UNI_TOKEN3_WETH_PAIR = '0xc07f36310Cda74D25729C3b8EEc4046902c9a476';
  const ORACLE_TOKEN1_WETH = '0x736e5d513381f819BAedF8535aDe30aeFE07c3E0';
  const ORACLE_TOKEN2_WETH = '0xe6d37522B5C1b238a41D668297fA9046fDeD63C7';
  const ORACLE_TOKEN3_WETH = '0x6e5aC0d638511D60934F2a30f0921AE3f32C6400';
  const CK_TOKEN_NAME = 'New Index';
  const CK_TOKEN_SYMBOL = 'NEW';
  const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

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
   * deploy uniswapPairPriceAdapter
   * 
   * params -
   * _controller: address
   * _uniswapFactory: address
   * _uniswapPools: address[]
   */
  const UniswapPairPriceAdapter = await ethers.getContractFactory("UniswapPairPriceAdapter");
  const uniswapPairPriceAdapter = await UniswapPairPriceAdapter.deploy(
    controller.address,
    UNISWAP_FACTORY,
    [UNI_TOKEN1_WETH_PAIR, UNI_TOKEN2_WETH_PAIR, UNI_TOKEN3_WETH_PAIR]
  );
  await uniswapPairPriceAdapter.deployed();
  console.log("uniswapPairPriceAdapter address:", uniswapPairPriceAdapter.address);

  /**
   * deploy priceOracle
   * 
   * params -
   * _controller: address
   * _masterQuoteAsset: address
   * _adapters: address[]
   * _assetOnes: address[]
   * _assetTwos: address[]
   * _oracles: address[]
   */
  const PriceOracle = await ethers.getContractFactory("PriceOracle");
  const priceOracle = await PriceOracle.deploy(
     controller.address,
     WETH_ADDRESS,
     [uniswapPairPriceAdapter.address],
     [TOKEN_1, TOKEN_2, TOKEN_3],
     [WETH_ADDRESS, WETH_ADDRESS, WETH_ADDRESS],
     [ORACLE_TOKEN1_WETH, ORACLE_TOKEN2_WETH, ORACLE_TOKEN3_WETH]
   );
  await priceOracle.deployed();
  console.log("priceOracle address:", priceOracle.address);

  /**
   * deploy ckValuer
   * 
   * params -
   * controller: IController
   */ 
   const CKValuer = await ethers.getContractFactory("CKValuer");
   const ckValuer = await CKValuer.deploy(controller.address);
   await ckValuer.deployed();
   console.log("ckValuer address:", ckValuer.address);

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
   * deploy SingleIndexModule
   * 
   * params -
   * controller: IController
   */ 
  const SingleIndexModule = await ethers.getContractFactory("SingleIndexModule");
  const singleIndexModule = await SingleIndexModule.deploy(
    controller.address,
    WETH_ADDRESS,
    UNISWAP_ROUTER,
    SUSHISWAP_ROUTER,
    BALANCER_PROXY
  );
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
   * deploy BatchIssuanceModule
   * 
   * params -
   * controller: IController
   */ 
   const BatchIssuanceModule = await ethers.getContractFactory("BatchIssuanceModule");
   const batchIssuanceModule = await BatchIssuanceModule.deploy(controller.address, WETH_ADDRESS, basicIssuanceModule.address);
   await batchIssuanceModule.deployed();
   console.log("batchIssuanceModule address:", batchIssuanceModule.address);

  /**
   * initialize Controller
   * 
   * params -
   * factories: address[]
   * modules: address[]
   * resources: address[]
   * resourceIds: address[]
   */
  const txControllerInitialized = await controller.initialize(
    [ckTokenCreator.address],
    [
      streamingFeeModule.address,
      basicIssuanceModule.address,
      wrapModule.address,
      tradeModule.address,
      singleIndexModule.address,
      governanceModule.address,
      batchIssuanceModule.address
    ],
    [integrationRegistry.address, priceOracle.address, ckValuer.address],
    [0, 1, 2]
  );
  await txControllerInitialized.wait();
  console.log("controller initialized:", !!txControllerInitialized);

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
  const txCkTokenCreated: ContractTransaction = await ckTokenCreator.create(
    [TOKEN_1, TOKEN_2, TOKEN_3],
    ['50000000000000000000', '30000000000000000000', '20000000000000000000'],
    [
      streamingFeeModule.address,
      basicIssuanceModule.address,
      wrapModule.address,
      tradeModule.address,
      singleIndexModule.address,
      governanceModule.address,
      batchIssuanceModule.address
    ],
    manager,
    CK_TOKEN_NAME,
    CK_TOKEN_SYMBOL
  );
  await txCkTokenCreated.wait();
  const retrievedCKAddress = await new ProtocolUtils(ethers.provider).getCreatedCKTokenAddress(txCkTokenCreated.hash);
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
  const txStreamingFeeModuleInitialized = await streamingFeeModule.initialize(
    ckToken.address,
    {
      feeRecipient: indexFeeRecipient,
      maxStreamingFeePercentage: "50000000000000000", // 5%
      streamingFeePercentage: "9500000000000000", // 0.95%
      lastStreamingFeeTimestamp: 0
    }
  );
  await txStreamingFeeModuleInitialized.wait();
  console.log("streamingFeeModule initialized:", !!txStreamingFeeModuleInitialized);

  /**
   * initialize BasicIssuanceModule
   * 
   * params -
   * ckToken: ICKToken
   * preIssueHook: IManagerIssuanceHook
   */
  const txBasicIssuanceModuleInitialized = await basicIssuanceModule.initialize(
    ckToken.address,
    ZERO_ADDRESS
  );
  await txBasicIssuanceModuleInitialized.wait();
  console.log("basicIssuanceModule initialized:", !!txBasicIssuanceModuleInitialized);

  /**
   * initialize TradeModule
   * 
   * params -
   * ckToken: ICKToken
   */
  const txTradeModuleInitialized = await tradeModule.initialize(ckToken.address);
  await txTradeModuleInitialized.wait();
  console.log("tradeModule initialized:", !!txTradeModuleInitialized);

  /**
   * initialize SingleIndexModule
   * 
   * params -
   * ckToken: ICKToken
   */
  const txSingleIndexModuleInitialized = await singleIndexModule.initialize(ckToken.address);
  await txSingleIndexModuleInitialized.wait();
  console.log("singleIndexModule initialized:", !!txSingleIndexModuleInitialized);

  /**
   * initialize WrapModule
   * 
   * params -
   * ckToken: ICKToken
   */
  const txWrapModuleInitialized = await wrapModule.initialize(ckToken.address);
  await txWrapModuleInitialized.wait();
  console.log("wrapModule initialized:", !!txWrapModuleInitialized);

  /**
   * initialize GovernanceModule
   * 
   * params -
   * ckToken: ICKToken
   */
  const txGovernanceModuleInitialized = await governanceModule.initialize(ckToken.address);
  await txGovernanceModuleInitialized.wait();
  console.log("governanceModule initialized:", !!txGovernanceModuleInitialized);

  /**
   * initialize BatchIssuanceModule, add adapters and integrations
   * TODO: change the settings
   */
  const batchFeeRecipient = accounts[0].address;
  const batchIssuanceSetting = {
    feeRecipient: batchFeeRecipient,
    managerFees: [ether(0.04), ether(0.05)],
    maxManagerFee: ether(0.1),
    minCKTokenSupply: ether(0.001),
  } as BatchIssuanceSetting;
  const roundInputCap = ether(0.00001);
  const txBatchIssuanceModuleInitialized = await batchIssuanceModule.initialize(
    ckToken.address,
    batchIssuanceSetting,
    roundInputCap
  );
  await txBatchIssuanceModuleInitialized.wait();
  console.log("batchIssuanceModule initialized:", !!txBatchIssuanceModuleInitialized);

  // deploy exchange adapters
  const UniswapV2IndexExchangeAdapter = await ethers.getContractFactory("UniswapV2IndexExchangeAdapter");
  const uniswapAdapter = await UniswapV2IndexExchangeAdapter.deploy(UNISWAP_ROUTER);
  await uniswapAdapter.deployed();
  console.log("uniswapAdapter address:", uniswapAdapter.address);

  const sushiswapAdapter = await UniswapV2IndexExchangeAdapter.deploy(SUSHISWAP_ROUTER);
  await sushiswapAdapter.deployed();
  console.log("sushiswapAdapter address:", sushiswapAdapter.address);

  const BalancerV1IndexExchangeAdapter = await ethers.getContractFactory("BalancerV1IndexExchangeAdapter");
  const balancerAdapter = await BalancerV1IndexExchangeAdapter.deploy(BALANCER_PROXY);
  await balancerAdapter.deployed();
  console.log("balancerAdapter address:", balancerAdapter.address);

  // add integration to IntegrationRegistry
  const txAddIntegrations = await integrationRegistry.batchAddIntegration(
    [batchIssuanceModule.address, batchIssuanceModule.address, batchIssuanceModule.address],
    [UNISWAP_ADAPTER_NAME, SUSHISWAP_ADAPTER_NAME, BALANCER_ADAPTER_NAME],
    [uniswapAdapter.address, sushiswapAdapter.address, balancerAdapter.address]
  );
  await txAddIntegrations.wait();
  console.log("Integrations added:", !!txAddIntegrations);

  const txSetExchanges = await batchIssuanceModule.setExchanges(
    ckToken.address,
    [TOKEN_1, TOKEN_2, TOKEN_3],
    [UNISWAP_ADAPTER_NAME, UNISWAP_ADAPTER_NAME, UNISWAP_ADAPTER_NAME]
  );
  await txSetExchanges.wait();
  console.log("Exchanges set:", !!txSetExchanges);

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
