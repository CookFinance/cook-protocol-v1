import { ethers } from "hardhat";
import { ContractTransaction } from "ethers";
import { ProtocolUtils } from "../utils/common";
import { CKToken__factory } from "../typechain/factories/CKToken__factory";
import { ERC20ABI, WETHABI, UNIFACTORYABI, UNIV2PAIR, UNIV2RouterABI } from "./constant";

async function main() {
  console.log("-------------- Deployment Start --------------");
  // await run("compile");

  const accounts = await ethers.getSigners();
  // required contracts' addresses
  // TODO: currently set for Rinkeby testnet. should be changed for different chain
  const WBNB_ADDRESS = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";
  const UNISWAP_ROUTER_ADDRESS = "0x05fF2B0DB69458A0750badebc4f9e13aDd608C7F";
  const UNISWAP_FACTORY_ADDRESS = "0xBCfCcbde45cE874adCB698cC183deBcF17952812";
  const SUSHISWAP_ROUTER_ADDRESS = "0x0000000000000000000000000000000000000000";
  const BALANCER_V2_PROXY_ADDRESS = "0x0000000000000000000000000000000000000000";
  const PRE_ISSUE_HOOK = "0x0000000000000000000000000000000000000000";

  // Tokens
  const WBNB_BSC = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";
  const CAKE_BSC = "0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82";
  const XVS_BSC = "0xcf6bb5389c92bdda8a3747ddb454cb7a64626c63";
  const BAKE_BSC = "0xE02dF9e3e622DeBdD69fb838bB799E3F168902c5";
  const ALPHA_BSC = "0xa1faa113cbe53436df28ff0aee54275c13b40975";
  const SXP_BSC = "0x47bead2563dcbf3bf2c9407fea4dc236faba485a";
  const LINA_BSC = "0x762539b45a1dcce3d36d080f74d1aed37844b878";
  const INCH_BSC = "0x111111111117dc0aa78b770fa6a738034120c302";
  const REEF_BSC = "0xf21768ccbc73ea5b6fd3c687208a7c2def2d966e";
  const INJ_BSC = "0xa2b726b1145a4773f68593cf171187d8ebe4d495";
  const BUSD_BSC = "0xe9e7cea3dedca5984780bafc599bd69add087d56";
  const USDC_BSC = "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d";
  const DAI_BSC = "0x1af3f329e8be154074d8769d1ffa4ee058b1dbc3";

  // CK tokens
  const CKTokens = [
    // {
    //   components: [CAKE_BSC, WBNB_BSC, BAKE_BSC, ALPHA_BSC],
    //   units: ["7214773949061120", "32423764681186600", "26545042754428400", "793661190355337"],
    //   name: "Cook BSC Major",
    //   symbol: "CBM",
    //   address: "0x0",
    // },
    {
      components: [BUSD_BSC, DAI_BSC, USDC_BSC],
      units: ["333333", "33333333", "333333"],
      name: "Cook Stable Index",
      symbol: "CSI",
      address: "0x0",
    },
    {
      components: [ALPHA_BSC, INJ_BSC, REEF_BSC, SXP_BSC, LINA_BSC, INCH_BSC],
      units: ["902259372", "736255903", "221376312", "887900427", "158877924", "290082997"],
      name: "Cook Defi Index",
      symbol: "CDI",
      address: "0x0",
    },
  ];

  const uniswapRouterV2 = await ethers.getContractAt(UNIV2RouterABI, UNISWAP_ROUTER_ADDRESS);
  const uniswapFactory = await ethers.getContractAt(UNIFACTORYABI, UNISWAP_FACTORY_ADDRESS);
  const wETH = await ethers.getContractAt(WETHABI, WBNB_BSC);

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
  const wrapModule = await WrapModule.deploy(controller.address, WBNB_ADDRESS);
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
  const generalIndexModule = await GeneralIndexModule.deploy(controller.address, WBNB_ADDRESS);
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

  let overrides = {
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

  var tokens_to_swap = [
    CAKE_BSC,
    BAKE_BSC,
    ALPHA_BSC,
    SXP_BSC,
    LINA_BSC,
    INCH_BSC,
    REEF_BSC,
    INJ_BSC,
    BUSD_BSC,
    USDC_BSC,
    DAI_BSC,
  ];
  for (var i = 0; i < tokens_to_swap.length; i++) {
    await uniswapRouterV2
      .connect(cookProtocolDeployer)
      .swapExactETHForTokens(
        0,
        [WBNB_BSC, tokens_to_swap[i]],
        cookProtocolDeployer.address,
        Date.now() * 2,
        overrides,
      );
    await uniswapRouterV2
      .connect(uniswap_creator)
      .swapExactETHForTokens(
        0,
        [WBNB_BSC, tokens_to_swap[i]],
        uniswap_creator.address,
        Date.now() * 2,
        overrides,
      );

    const erc20 = await ethers.getContractAt(ERC20ABI, tokens_to_swap[i]);
    await erc20
      .connect(uniswap_creator)
      .approve(basicIssuanceModule.address, "10000000000000000000000000");
    console.log("--------", (await erc20.balanceOf(cookProtocolDeployer.address)).toString());
    // console.log((await erc20.connect(uniswap_creator).allowance(uniswap_creator.address, basicIssuanceModule.address)).toString());
  }
  await wETH.connect(cookProtocolDeployer).deposit(overrides);
  await wETH.connect(uniswap_creator).deposit(overrides);
  await wETH
    .connect(uniswap_creator)
    .approve(basicIssuanceModule.address, "10000000000000000000000000");

  console.log("------------- Swap tokens Completed ------------");

  console.log("------------- Issue CkTokens for account[1] --------------");

  const issue_amount = "10000000000000000000";

  for (var i = 0; i < CKTokens.length; i++) {
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
      .issue(CKTokens[i].address, issue_amount, uniswap_creator.address);
    console.log("--------issued ck token successfully --------");

    // const ckToken = await ethers.getContractAt(ERC20ABI, CKTokens[i].address);
    // console.log((await ckToken.connect(uniswap_creator).balanceOf(uniswap_creator.address)).toString());
    await uniswapFactory.connect(uniswap_creator).createPair(CKTokens[i].address, WBNB_BSC);
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
        WBNB_BSC,
        "10000000000000000000",
        "10000000000000000000",
        "1000",
        "1000",
        uniswap_creator.address,
        Date.now() * 2,
      );
    const pairAddress = await uniswapFactory
      .connect(uniswap_creator)
      .getPair(CKTokens[i].address, WBNB_BSC);

    console.log(`%s liquidity pool:`, CKTokens[i].name, pairAddress);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
