// @ts-ignore
import { ethers } from "hardhat";
import { ContractTransaction } from "ethers";
import { ProtocolUtils } from "../utils/common";
import { CKToken__factory } from "../typechain/factories/CKToken__factory";
import { ERC20ABI, WETHABI, UNIFACTORYABI, UNIV2PAIR, UNIV2RouterABI } from "./constant";
import { IntegrationRegistry, UniswapV2IndexExchangeAdapter__factory } from "../typechain";
import { bitcoin, ether } from "../utils/index";
import { MAX_UINT_256, ZERO } from "../utils/constants";
import { BigNumber } from "@ethersproject/bignumber";

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
  const MAKER_MAIN = "0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2";
  const LINK_MAIN = "0x514910771af9ca656af840dff83e8264ecf986ca";
  const DAI_MAIN = "0x6b175474e89094c44da98b954eedeac495271d0f";
  const USDC_MAIN = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";

  const ONE_MINUTE_IN_SECONDS: BigNumber = BigNumber.from(60);

  // Exchange Adapters
  const uniswapAdapterName = "UNISWAP";

  // CK tokens
  const CKTokens = [
    {
      components: [WBTC_MAIN, WETH_MAIN, UNI_MAIN, LINK_MAIN, AAVE_MAIN],
      tradeMaximums: [bitcoin(.1), ether(10), ether(1000), ether(1000), ether(80)],
      exchanges: [uniswapAdapterName, uniswapAdapterName, uniswapAdapterName, uniswapAdapterName, uniswapAdapterName],
      coolOffPeriods: [ONE_MINUTE_IN_SECONDS, ONE_MINUTE_IN_SECONDS, ONE_MINUTE_IN_SECONDS, ONE_MINUTE_IN_SECONDS, ONE_MINUTE_IN_SECONDS],
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
      positionMultiplier: BigNumber.from(0),
    },
    {
      components: [USDT_MAIN, DAI_MAIN, USDC_MAIN],
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
      exchanges: [uniswapAdapterName, uniswapAdapterName, uniswapAdapterName, uniswapAdapterName, uniswapAdapterName, uniswapAdapterName],
      coolOffPeriods: [ONE_MINUTE_IN_SECONDS, ONE_MINUTE_IN_SECONDS, ONE_MINUTE_IN_SECONDS, ONE_MINUTE_IN_SECONDS, ONE_MINUTE_IN_SECONDS,
        ONE_MINUTE_IN_SECONDS],
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
   * Deploy GeneralIndexModule
   */

  const GeneralIndexModule = await ethers.getContractFactory("GeneralIndexModule");
  const generalIndexModule = await GeneralIndexModule.deploy(controller.address, WETH_MAIN);
  await generalIndexModule.deployed();
  console.log("generalIndexModule address:", generalIndexModule.address);

  /**
   * Deploy UniswapV2IndexExchangeAdapter
   */
  const UniswapV2IndexExchangeAdapter = await ethers.getContractFactory("UniswapV2IndexExchangeAdapter");
  const uniswapV2IndexExchangeAdapter = await UniswapV2IndexExchangeAdapter.deploy(UNISWAP_ROUTER_ADDRESS);
  await uniswapV2IndexExchangeAdapter.deployed();
  console.log("uniswapV2IndexExchangeAdapter address:", uniswapV2IndexExchangeAdapter.address);

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
   * Add Uniswap exchange adapter to integration registry.
   */
  await integrationRegistry.addIntegration(generalIndexModule.address, uniswapAdapterName, uniswapV2IndexExchangeAdapter.address);
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
    await generalIndexModule.setTradeMaximums(ckToken.address, CKTokens[i].components, CKTokens[i].tradeMaximums);
    await generalIndexModule.setExchanges(ckToken.address, CKTokens[i].components, CKTokens[i].exchanges);
    await generalIndexModule.setCoolOffPeriods(ckToken.address, CKTokens[i].components, CKTokens[i].coolOffPeriods);
    await generalIndexModule.setTraderStatus(ckToken.address, [cookProtocolDeployer.address], [true]);
    console.log("singleIndexModule initialized:", !!generalIndexModuleInitialized);

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
  }

  console.log("------------- Deployment Completed ------------");

  const overrides = {
    value: ethers.utils.parseEther("1000"),
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

  const tokens_to_swap = [
    WBTC_MAIN,
    USDT_MAIN,
    UNI_MAIN,
    AAVE_MAIN,
    COMP_MAIN,
    YFI_MAIN,
    SUSHI_MAIN,
    MAKER_MAIN,
    LINK_MAIN,
    DAI_MAIN,
    USDC_MAIN,
  ];
  for (let i = 0; i < tokens_to_swap.length; i++) {
    await uniswapRouterV2
      .connect(cookProtocolDeployer)
      .swapExactETHForTokens(
        0,
        [WETH_MAIN, tokens_to_swap[i]],
        cookProtocolDeployer.address,
        Date.now() * 2,
        overrides,
      );
    await uniswapRouterV2
      .connect(uniswap_creator)
      .swapExactETHForTokens(
        0,
        [WETH_MAIN, tokens_to_swap[i]],
        uniswap_creator.address,
        Date.now() * 2,
        overrides,
      );

    const erc20 = await ethers.getContractAt(ERC20ABI, tokens_to_swap[i]);
    await erc20
      .connect(uniswap_creator)
      .approve(basicIssuanceModule.address, "10000000000000000000000000");
    // console.log((await erc20.connect(uniswap_creator).allowance(uniswap_creator.address, basicIssuanceModule.address)).toString());
  }
  await wETH.connect(cookProtocolDeployer).deposit(overrides);
  await wETH.connect(uniswap_creator).deposit(overrides);
  await wETH
    .connect(uniswap_creator)
    .approve(basicIssuanceModule.address, "10000000000000000000000000");

  console.log("------------- Swap tokens Completed ------------");

  console.log("------------- Issue CkTokens for account[1] --------------");

  const issue_amoount = "20000000000000000000";

  for (let i = 0; i < CKTokens.length; i++) {
    // for (var j = 0; j < CKTokens[i].components.length; j++) {
    //   const requiredToken = await ethers.getContractAt(ERC20ABI, CKTokens[i].components[j]);
    //   const cur_balance = await requiredToken
    //     .connect(uniswap_creator)
    //     .balanceOf(uniswap_creator.address);
    //   console.log(`%s: `, CKTokens[i].components[j], cur_balance.toString());
    //   console.log(CKTokens[i].units[j]);
    // }

    await basicIssuanceModule
      .connect(uniswap_creator)
      .issue(CKTokens[i].address, issue_amoount, uniswap_creator.address);
    console.log("--------issued ck token successfully --------");

    // const ckToken = await ethers.getContractAt(ERC20ABI, CKTokens[i].address);
    // console.log((await ckToken.connect(uniswap_creator).balanceOf(uniswap_creator.address)).toString());
    await uniswapFactory.connect(uniswap_creator).createPair(CKTokens[i].address, WETH_MAIN);
    console.log("-------- pair created -----------");
    // console.log(CKTokens[i].address);
    const ckTokenErc20 = await ethers.getContractAt(ERC20ABI, CKTokens[i].address);
    await wETH
      .connect(uniswap_creator)
      .approve(uniswapRouterV2.address, "10000000000000000000000000");
    await ckTokenErc20
      .connect(uniswap_creator)
      .approve(uniswapRouterV2.address, "10000000000000000000000000");
    await uniswapRouterV2
      .connect(uniswap_creator)
      .addLiquidity(
        CKTokens[i].address,
        WETH_MAIN,
        "10000000000000000000",
        "10000000000000000000",
        "1000",
        "1000",
        uniswap_creator.address,
        Date.now() * 2,
      );
    const pairAddress = await uniswapFactory
      .connect(uniswap_creator)
      .getPair(CKTokens[i].address, WETH_MAIN);

    console.log(`%s liquidity pool:`, CKTokens[i].name, pairAddress);
  }

  console.log("------------- Try to rebalance --------------");
  const oldTargetUnits = [
    "56277",
    "7214773949061120",
    "32423764681186600",
    "26545042754428400",
    "793661190355337",
  ];
  await generalIndexModule.startRebalance(CKTokens[0].address, [], [], oldTargetUnits, CKTokens[0].positionMultiplier);
  const wbtc = await ethers.getContractAt(ERC20ABI, WBTC_MAIN);
  console.log("WBTC balance before rebalance: ", (await wbtc.balanceOf(CKTokens[0].address)).toString());
  await generalIndexModule.connect(cookProtocolDeployer).trade(CKTokens[0].address, WBTC_MAIN, ZERO);
  console.log("WBTC balance after rebalance: ", (await wbtc.balanceOf(CKTokens[0].address)).toString());

}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
