// @ts-ignore
import { ethers } from "hardhat";
import { ContractTransaction } from "ethers";
import { ProtocolUtils } from "../utils/common";
import { CKToken__factory } from "../typechain/factories/CKToken__factory";
import { ERC20ABI, WETHABI, UNIFACTORYABI, UNIV2PAIR, UNIV2RouterABI } from "./constant";
import { BatchIssuanceModule, IntegrationRegistry, UniswapV2IndexExchangeAdapter__factory } from "../typechain";
import { bitcoin, ether } from "../utils/index";
import { MAX_UINT_256, ZERO } from "../utils/constants";
import { BigNumber } from "@ethersproject/bignumber";

async function main() {
  console.log("-------------- Deployment Start --------------");
  // await run("compile");

  const accounts = await ethers.getSigners();
  // required contracts' addresses
  // TODO: currently set for forked mainnet. should be changed for different chain
  const WETH_ADDRESS = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
  const UNISWAP_ROUTER_ADDRESS = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
  const UNISWAP_FACTORY_ADDRESS = "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f";
  const SUSHISWAP_ROUTER_ADDRESS = "0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F";
  const BALANCER_V2_PROXY_ADDRESS = "0x3E66B66Fd1d0b02fDa6C811Da9E0547970DB2f21";
  const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

  // Tokens
  const WBTC_MAIN = "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599";
  const WETH_MAIN = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
  const USDT_MAIN = "0xdac17f958d2ee523a2206206994597c13d831ec7";
  const UNI_MAIN = "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984";
  const AAVE_MAIN = "0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9";
  const COMP_MAIN = "0xc00e94cb662c3520282e6f5717214004a7f26888";
  const YFI_MAIN = "0x0bc529c00c6401aef6d220be8c6ea1667f6ad93e";
  const SUSHI_MAIN = "0x6b3595068778dd592e39a122f4f5a5cf09c90fe2";
  const MAKER_MAIN = "0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2";
  const LINK_MAIN = "0x514910771af9ca656af840dff83e8264ecf986ca";
  const DAI_MAIN = "0x6b175474e89094c44da98b954eedeac495271d0f";
  const USDC_MAIN = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";

  // Chainlink Price Aggregators
  const WBTC_USDC_AGGREGATOR = '0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c';
  const UNI_USDC_AGGREGATOR = '0x553303d460EE0afB37EdFf9bE42922D8FF63220e';
  const AAVE_USDC_AGGREGATOR = '0x547a514d5e3769680Ce22B2361c10Ea13619e8a9';
  const COMP_USDC_AGGREGATOR = '0xdbd020CAeF83eFd542f4De03e3cF0C28A4428bd5';
  const SUSHI_USDC_AGGREGATOR = '0xCc70F09A6CC17553b2E31954cD36E4A2d89501f7';
  const MAKER_USDC_AGGREGATOR = '0xec1D1B3b0443256cc3860e24a46F108e699484Aa';
  const LINK_USDC_AGGREGATOR = '0x2c1d072e956AFFC0D435Cb7AC38EF18d24d9127c';
  const DAI_USDC_AGGREGATOR = '0xAed0c38402a5d19df6E4c03F4E2DceD6e29c1ee9';
  const USDT_USDC_AGGREGATOR = '0x3E7d1eAB13ad0104d2750B8863b489D65364e32D';
  const WETH_USDC_AGGREGATOR = '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419';

  const ONE_MINUTE_IN_SECONDS: BigNumber = BigNumber.from(60);

  // Exchange Adapters
  const uniswapAdapterName = "UNISWAP";
  const sushiswapAdapterName = "SUSHISWAP";
  const balancerAdapterName = "BALANCER";

  // CK tokens
  const CKTokens = [
    {
      components: [WBTC_MAIN, WETH_MAIN, UNI_MAIN, LINK_MAIN, AAVE_MAIN],
      tradeMaximums: [bitcoin(0.1), ether(10), ether(1000), ether(1000), ether(80)],
      exchanges: [
        uniswapAdapterName,
        uniswapAdapterName,
        uniswapAdapterName,
        uniswapAdapterName,
        uniswapAdapterName,
      ],
      coolOffPeriods: [
        ONE_MINUTE_IN_SECONDS,
        ONE_MINUTE_IN_SECONDS,
        ONE_MINUTE_IN_SECONDS,
        ONE_MINUTE_IN_SECONDS,
        ONE_MINUTE_IN_SECONDS,
      ],
      units: [
        "116277",
        "7214773949061120",
        "32423764681186600",
        "26545042754428400",
        "793661190355337",
      ],
      name: "Cook ETH Major",
      symbol: "CEJ",
      address: "0x0",
      positionMultiplier: BigNumber.from(0),
    },
    {
      components: [USDC_MAIN, DAI_MAIN, USDT_MAIN],
      tradeMaximums: [bitcoin(30000), ether(30000), ether(30000)],
      exchanges: [uniswapAdapterName, uniswapAdapterName, uniswapAdapterName],
      coolOffPeriods: [ONE_MINUTE_IN_SECONDS, ONE_MINUTE_IN_SECONDS, ONE_MINUTE_IN_SECONDS],
      units: ["333333", "333333333333333333", "333333"],
      name: "Cook Stable Index",
      symbol: "CSI",
      address: "0x0",
      positionMultiplier: BigNumber.from(0),
    },
    {
      components: [UNI_MAIN, LINK_MAIN, AAVE_MAIN, COMP_MAIN, MAKER_MAIN, SUSHI_MAIN],
      tradeMaximums: [bitcoin(1000), ether(1000), ether(80), ether(80), ether(10), ether(2500)],
      exchanges: [
        uniswapAdapterName,
        uniswapAdapterName,
        uniswapAdapterName,
        uniswapAdapterName,
        uniswapAdapterName,
        uniswapAdapterName,
      ],
      coolOffPeriods: [
        ONE_MINUTE_IN_SECONDS,
        ONE_MINUTE_IN_SECONDS,
        ONE_MINUTE_IN_SECONDS,
        ONE_MINUTE_IN_SECONDS,
        ONE_MINUTE_IN_SECONDS,
        ONE_MINUTE_IN_SECONDS,
      ],
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
      positionMultiplier: BigNumber.from(0),
    },
  ];

  const cookProtocolDeployer = accounts[0];
  const batchIssuanceRecipient = accounts[1];
  const player1 = accounts[2];
  const player2 = accounts[3];

  const DEXDeployer = await ethers.getContractFactory("UniswapV2IndexExchangeAdapter");
  const uniswapExchangeAdapter = await DEXDeployer.deploy(UNISWAP_ROUTER_ADDRESS);
  const sushiswapExchangeAdapter = await DEXDeployer.deploy(SUSHISWAP_ROUTER_ADDRESS);

  /**
   * deploy Chainlink Oracle Adapters
   */
  const ChainlinkOracleAdapter = await ethers.getContractFactory("ChainlinkOracleAdapter");
  const wbtc_usdc_oracle = await ChainlinkOracleAdapter.deploy(WBTC_USDC_AGGREGATOR, 10);
  await wbtc_usdc_oracle.deployed();
  console.log("wbtc_usdc_oracle address:", wbtc_usdc_oracle.address);
  const uni_usdc_oracle = await ChainlinkOracleAdapter.deploy(UNI_USDC_AGGREGATOR, 10);
  await uni_usdc_oracle.deployed();
  console.log("uni_usdc_oracle address:", uni_usdc_oracle.address);
  const aave_usdc_oracle = await ChainlinkOracleAdapter.deploy(AAVE_USDC_AGGREGATOR, 10);
  await aave_usdc_oracle.deployed();
  console.log("aave_usdc_oracle address:", aave_usdc_oracle.address);
  const comp_usdc_oracle = await ChainlinkOracleAdapter.deploy(COMP_USDC_AGGREGATOR, 10);
  await comp_usdc_oracle.deployed();
  console.log("comp_usdc_oracle address:", comp_usdc_oracle.address);
  const sushi_usdc_oracle = await ChainlinkOracleAdapter.deploy(SUSHI_USDC_AGGREGATOR, 10);
  await sushi_usdc_oracle.deployed();
  console.log("sushi_usdc_oracle address:", sushi_usdc_oracle.address);
  const maker_usdc_oracle = await ChainlinkOracleAdapter.deploy(MAKER_USDC_AGGREGATOR, 10);
  await maker_usdc_oracle.deployed();
  console.log("maker_usdc_oracle address:", maker_usdc_oracle.address);
  const link_usdc_oracle = await ChainlinkOracleAdapter.deploy(LINK_USDC_AGGREGATOR, 10);
  await link_usdc_oracle.deployed();
  console.log("link_usdc_oracle address:", link_usdc_oracle.address);
  const dai_usdc_oracle = await ChainlinkOracleAdapter.deploy(DAI_USDC_AGGREGATOR, 10);
  await dai_usdc_oracle.deployed();
  console.log("dai_usdc_oracle address:", dai_usdc_oracle.address);
  const usdt_usdc_oracle = await ChainlinkOracleAdapter.deploy(USDT_USDC_AGGREGATOR, 10);
  await usdt_usdc_oracle.deployed();
  console.log("usdt_usdc_oracle address:", usdt_usdc_oracle.address);
  const weth_usdc_oracle = await ChainlinkOracleAdapter.deploy(WETH_USDC_AGGREGATOR, 10);
  await weth_usdc_oracle.deployed();
  console.log("weth_usdc_oracle address:", weth_usdc_oracle.address);

  /**
   * deploy controller
   *
   * params -
   * feeRecipient: address
   */
  const Controller = await ethers.getContractFactory("Controller");
  const controller = await Controller.deploy(cookProtocolDeployer.address);
  await controller.deployed();
  console.log("controller address:", controller.address);

 /**
  *  deploy uniswap price pair adapter
  */  
  const UniswapPairPriceAdapter = await ethers.getContractFactory("UniswapPairPriceAdapter");
  const uniswapPairPriceAdapter = await UniswapPairPriceAdapter.deploy(
    controller.address,
    UNISWAP_FACTORY_ADDRESS,
    [
      "0xBb2b8038a1640196FbE3e38816F3e67Cba72D940", // WBTC WETH
      "0xd3d2E2692501A5c9Ca623199D38826e513033a17", // UNI WETH
      "0xDFC14d2Af169B0D36C4EFF567Ada9b2E0CAE044f", // AAVE WETH
      "0xCFfDdeD873554F362Ac02f8Fb1f02E5ada10516f", // COMP WETH
      "0xCE84867c3c02B05dc570d0135103d3fB9CC19433", // SUSHI WETH
      "0xC2aDdA861F89bBB333c90c492cB837741916A225", // MAKER WETH
      "0xa2107FA5B38d9bbd2C461D6EDf11B11A50F6b974", // LINK WETH
      "0xA478c2975Ab1Ea89e8196811F51A7B7Ade33eB11", // DAI WETH
      "0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc", // USDT WETH
    ],
  ); 
  await uniswapPairPriceAdapter.deployed();
  console.log("uniswapPairPriceAdapter :", uniswapPairPriceAdapter.address);

 /**
  * Deploy Oracle
  */
  const PriceOracle = await ethers.getContractFactory("PriceOracle");
  const priceOracle = await PriceOracle.deploy(
    controller.address,
    USDC_MAIN,
    [uniswapPairPriceAdapter.address],
    [WBTC_MAIN, UNI_MAIN, AAVE_MAIN, COMP_MAIN, SUSHI_MAIN, MAKER_MAIN, LINK_MAIN, DAI_MAIN, USDT_MAIN, WETH_MAIN],
    [USDC_MAIN, USDC_MAIN, USDC_MAIN, USDC_MAIN, USDC_MAIN, USDC_MAIN, USDC_MAIN, USDC_MAIN, USDC_MAIN, USDC_MAIN],
    [
      wbtc_usdc_oracle.address,
      uni_usdc_oracle.address,
      aave_usdc_oracle.address,
      comp_usdc_oracle.address,
      sushi_usdc_oracle.address,
      maker_usdc_oracle.address,
      link_usdc_oracle.address,
      dai_usdc_oracle.address,
      usdt_usdc_oracle.address,
      weth_usdc_oracle.address,
    ],
  )
  await priceOracle.deployed();
  console.log("priceOracle address:", priceOracle.address);

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
   *  deplopy CkToken valuer
   */
  const CKTokenValuer = await ethers.getContractFactory("CKValuer");
  const ckTokenValuer = await CKTokenValuer.deploy(controller.address);
  await ckTokenValuer.deployed();
  console.log("ckValuer address:", ckTokenCreator.address);  

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
   * Deploy GeneralIndexModule
   */

  const GeneralIndexModule = await ethers.getContractFactory("GeneralIndexModule");
  const generalIndexModule = await GeneralIndexModule.deploy(controller.address, WETH_MAIN);
  await generalIndexModule.deployed();
  console.log("generalIndexModule address:", generalIndexModule.address);

  /**
   * Deploy BatchIssuanceModule
   */
  const BatchIssuanceModule = await ethers.getContractFactory("BatchIssuanceModule");
  const batchIssuanceModule = await BatchIssuanceModule.deploy(
    controller.address,
    WETH_ADDRESS,
    basicIssuanceModule.address
  );
  await batchIssuanceModule.deployed();
  console.log("batchIssueModule address:", batchIssuanceModule.address);

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
      batchIssuanceModule.address,
    ],
    [integrationRegistry.address, priceOracle.address, ckTokenValuer.address],
    [0, 1, 2],
  );
  await controllerInitialized.wait();
  console.log("controller initialized:", !!controllerInitialized);

  /**
   * Add exchange adapters to integration registry
   */
  const txAddIntegrations = await integrationRegistry.batchAddIntegration(
    [generalIndexModule.address, batchIssuanceModule.address, batchIssuanceModule.address],
    [uniswapAdapterName, sushiswapAdapterName, uniswapAdapterName],
    [uniswapExchangeAdapter.address, sushiswapExchangeAdapter.address, uniswapExchangeAdapter.address],
  );
  await txAddIntegrations.wait();
  console.log("Add Uniswap exchange adapter to integration registry");

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
  for (let i = 0; i < CKTokens.length; i++) {
    const ckTokenCreated: ContractTransaction = await ckTokenCreator.create(
      CKTokens[i].components,
      CKTokens[i].units,
      [
        streamingFeeModule.address,
        basicIssuanceModule.address,
        wrapModule.address,
        tradeModule.address,
        generalIndexModule.address,
        governanceModule.address,
        batchIssuanceModule.address,
      ],
      cookProtocolDeployer.address,
      CKTokens[i].name,
      CKTokens[i].symbol,
    );

    await ckTokenCreated.wait();

    const retrievedCKAddress = await new ProtocolUtils(ethers.provider).getCreatedCKTokenAddress(
      ckTokenCreated.hash,
    );
    const ckToken = new CKToken__factory(cookProtocolDeployer).attach(retrievedCKAddress);
    console.log("ckToken %s address: %s", CKTokens[i].symbol, ckToken.address);
    CKTokens[i].address = retrievedCKAddress;
    CKTokens[i].positionMultiplier = await ckToken.positionMultiplier();
    /**
     * initialize StreamingFeeModule
     *
     * params -
     * ckToken: ICKToken
     * settings: FeeState
     */

    const streamingFeeModuleInitialized = await streamingFeeModule.initialize(ckToken.address, {
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
    const basicIssuanceModuleInitialized = await basicIssuanceModule.initialize(
      ckToken.address,
      ZERO_ADDRESS,
    );
    await basicIssuanceModuleInitialized.wait();
    console.log("basicIssuanceModule initialized:", !!basicIssuanceModuleInitialized);

    // get instances for uniswap router and WETH contract
    const uniswapRouterV2 = await ethers.getContractAt(UNIV2RouterABI, UNISWAP_ROUTER_ADDRESS);
    const wETH = await ethers.getContractAt(WETHABI, WETH_MAIN);
    /**
     * initialize BasicIssuanceModule
     *
     * params -
     * ckToken: ICKToken
     * preIssueHook: IManagerIssuanceHook
     */
    const minCKTokenSupply = 1;
    const batchIssuanceSetting = {
        feeRecipient: batchIssuanceRecipient.address,
        managerFees: [ether(0.04), ether(0.05)],
        maxManagerFee: ether(0.1),
        minCKTokenSupply: ether(minCKTokenSupply),
    };    

    const batchIssuanceModuleInitialized = await batchIssuanceModule.initialize(
      CKTokens[i].address,
      batchIssuanceSetting,
      ethers.utils.parseEther("5"),
    );
    await basicIssuanceModuleInitialized.wait();
    console.log("batchIssuanceModule initialized:", !!batchIssuanceModuleInitialized);    

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
     * initialize GeneralIndexModule
     *
     * params -
     * ckToken: ICKToken
     */
    const generalIndexModuleInitialized = await generalIndexModule.initialize(ckToken.address);
    await generalIndexModuleInitialized.wait();
    await generalIndexModule.setTradeMaximums(
      ckToken.address,
      CKTokens[i].components,
      CKTokens[i].tradeMaximums,
    );
    await generalIndexModule.setExchanges(
      ckToken.address,
      CKTokens[i].components,
      CKTokens[i].exchanges,
    );
    await generalIndexModule.setCoolOffPeriods(
      ckToken.address,
      CKTokens[i].components,
      CKTokens[i].coolOffPeriods,
    );
    await generalIndexModule.setTraderStatus(
      ckToken.address,
      [cookProtocolDeployer.address],
      [true],
    );
    console.log("generalIndexModule initialized:", !!generalIndexModuleInitialized);

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

    /**
     * Mint minimum CK amount for batch issue
     */
    for (let j = 0; j < CKTokens[i].components.length; j++) {
      const componentAsset = CKTokens[i].components[j];
      const requiredAmount = BigNumber.from(CKTokens[i].units[j]).mul(minCKTokenSupply);
      if (componentAsset === WETH_MAIN) {
        await wETH.connect(player2).deposit({value: requiredAmount, gasLimit: 600000});
      } else {
        const callData = {
          value: ethers.utils.parseEther("1000"),
          gasLimit: 600000,
        };
        await uniswapRouterV2
          .connect(player2)
          .swapETHForExactTokens(
            requiredAmount,
            [WETH_MAIN, componentAsset],
            player2.address,
            Date.now() * 2,
            callData,
          );
      }
      const erc20 = await ethers.getContractAt(ERC20ABI, componentAsset);
      await erc20
        .connect(player2)
        .approve(basicIssuanceModule.address, "10000000000000000000000000");
    }
    await basicIssuanceModule
      .connect(player2)
      .issue(CKTokens[i].address, batchIssuanceSetting.minCKTokenSupply, player2.address);

    const txSetExchanges = await batchIssuanceModule.connect(cookProtocolDeployer).setExchanges(
      CKTokens[i].address,
      CKTokens[i].components,
      CKTokens[i].exchanges
    );
    await txSetExchanges.wait();
    console.log("----------- set up ck compoenents for batchIssuance module ----------")

    await batchIssuanceModule.connect(player1).depositEth(
      CKTokens[i].address,
      {
        value: ethers.utils.parseEther("11"),
        gasLimit: 600000,
      }
    );
    await batchIssuanceModule.connect(player1).batchIssue(CKTokens[i].address, [0, 1]);
    await batchIssuanceModule.connect(player1).withdraw(CKTokens[i].address, 2);
    console.log("------------ Deposited and Batch issued ----------");
    const ckAmounts = await ckToken.connect(player1).balanceOf(player1.address);
    console.log("----------- ck token balance -------------:, ", ckAmounts);
  }

  console.log("------------- Deployment Completed ------------");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
