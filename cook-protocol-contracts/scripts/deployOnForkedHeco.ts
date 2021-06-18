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
  const WHT_ADDRESS = "0x5545153ccfca01fbd7dd11c0b23ba694d9509a6f";
  const UNISWAP_ROUTER_ADDRESS = "0xED7d5F38C79115ca12fe6C0041abb22F0A06C300";
  const UNISWAP_FACTORY_ADDRESS = "0xb0b670fc1F7724119963018DB0BfA86aDb22d941";
  const SUSHISWAP_ROUTER_ADDRESS = "0x0000000000000000000000000000000000000000";
  const BALANCER_V2_PROXY_ADDRESS = "0x0000000000000000000000000000000000000000";
  const PRE_ISSUE_HOOK = "0x0000000000000000000000000000000000000000";

  // Tokens
  const WHT_HECO = "0x5545153ccfca01fbd7dd11c0b23ba694d9509a6f";
  const MDX_HECO = "0x25d2e80cb6b86881fd7e07dd263fb79f4abe033c";
  const HBTC_HECO = "0x66a79d23e58475d2738179ca52cd0b41d73f0bea";
  const MATTER_HECO = "0x1c9491865a1de77c5b6e19d2e6a5f1d7a6f2b25f";
  const LHB_HECO = "0x8f67854497218043e1f72908ffe38d0ed7f24721";

  // CK tokens
  const CKTokens = [
    {
      components: [MDX_HECO, HBTC_HECO, MATTER_HECO, LHB_HECO],
      units: ["1000000", "100000000", "1000000", "1000000"],
      name: "Cook Defi Index",
      symbol: "CDI",
      address: "0x0",
    },
  ];

  const uniswapRouterV2 = await ethers.getContractAt(UNIV2RouterABI, UNISWAP_ROUTER_ADDRESS);
  const uniswapFactory = await ethers.getContractAt(UNIFACTORYABI, UNISWAP_FACTORY_ADDRESS);
  const wETH = await ethers.getContractAt(WETHABI, WHT_HECO);

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
  const wrapModule = await WrapModule.deploy(controller.address, WHT_ADDRESS);
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
  const generalIndexModule = await GeneralIndexModule.deploy(controller.address, WHT_ADDRESS);
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

  console.log("------------- Start Swapping tokens for account[0] and account[1] ------------");

  const uniswap_creator = accounts[1];

  var tokens_to_swap = [MDX_HECO, HBTC_HECO, MATTER_HECO, LHB_HECO];

  for (var i = 0; i < tokens_to_swap.length; i++) {
    await uniswapRouterV2
      .connect(cookProtocolDeployer)
      .swapExactETHForTokens(
        0,
        [WHT_HECO, tokens_to_swap[i]],
        cookProtocolDeployer.address,
        Date.now() * 2,
        overrides,
      );
    await uniswapRouterV2
      .connect(uniswap_creator)
      .swapExactETHForTokens(
        0,
        [WHT_HECO, tokens_to_swap[i]],
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
    await uniswapFactory.connect(uniswap_creator).createPair(CKTokens[i].address, WHT_HECO);
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
        WHT_HECO,
        "10000000000000000000",
        "10000000000000000000",
        "1000",
        "1000",
        uniswap_creator.address,
        Date.now() * 2,
      );
    const pairAddress = await uniswapFactory
      .connect(uniswap_creator)
      .getPair(CKTokens[i].address, WHT_HECO);

    console.log(`%s liquidity pool:`, CKTokens[i].name, pairAddress);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
