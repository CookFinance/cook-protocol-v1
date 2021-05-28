import { Signer } from "ethers";
import { BigNumberish } from "@ethersproject/bignumber";

import {
  Controller,
  IntegrationRegistry,
  PriceOracle,
  CKToken,
  CKTokenCreator,
  CKValuer
} from "./../contracts";

import { Address } from "./../types";

import { Controller__factory } from "../../typechain/factories/Controller__factory";
import { IntegrationRegistry__factory } from "../../typechain/factories/IntegrationRegistry__factory";
import { PriceOracle__factory } from "../../typechain/factories/PriceOracle__factory";
import { CKToken__factory } from "../../typechain/factories/CKToken__factory";
import { CKTokenCreator__factory } from "../../typechain/factories/CKTokenCreator__factory";
import { CKValuer__factory } from "../../typechain/factories/CKValuer__factory";

export default class DeployCoreContracts {
  private _deployerSigner: Signer;

  constructor(deployerSigner: Signer) {
    this._deployerSigner = deployerSigner;
  }

  public async deployController(feeRecipient: Address): Promise<Controller> {
    return await new Controller__factory(this._deployerSigner).deploy(feeRecipient);
  }

  public async getController(controllerAddress: Address): Promise<Controller> {
    return await new Controller__factory(this._deployerSigner).attach(controllerAddress);
  }

  public async deployCKTokenCreator(controller: Address): Promise<CKTokenCreator> {
    return await new CKTokenCreator__factory(this._deployerSigner).deploy(controller);
  }

  public async getCKTokenCreator(ckTokenCreatorAddress: Address): Promise<CKTokenCreator> {
    return await new CKTokenCreator__factory(this._deployerSigner).attach(ckTokenCreatorAddress);
  }

  public async deployCKToken(
    _components: Address[],
    _units: BigNumberish[],
    _modules: Address[],
    _controller: Address,
    _manager: Address,
    _name: string,
    _symbol: string,
  ): Promise<CKToken> {
    return await new CKToken__factory(this._deployerSigner).deploy(
      _components,
      _units,
      _modules,
      _controller,
      _manager,
      _name,
      _symbol,
    );
  }

  public async getCKToken(ckTokenAddress: Address): Promise<CKToken> {
    return await new CKToken__factory(this._deployerSigner).attach(ckTokenAddress);
  }

  public async deployPriceOracle(
    controller: Address,
    masterQuoteAsset: Address,
    adapters: Address[],
    assetOnes: Address[],
    assetTwos: Address[],
    oracles: Address[],
  ): Promise<PriceOracle> {
    return await new PriceOracle__factory(this._deployerSigner).deploy(
      controller,
      masterQuoteAsset,
      adapters,
      assetOnes,
      assetTwos,
      oracles,
    );
  }

  public async getPriceOracle(priceOracleAddress: Address): Promise<PriceOracle> {
    return await new PriceOracle__factory(this._deployerSigner).attach(priceOracleAddress);
  }

  public async deployIntegrationRegistry(controller: Address): Promise<IntegrationRegistry> {
    return await new IntegrationRegistry__factory(this._deployerSigner).deploy(controller);
  }

  public async getIntegrationRegistry(integrationRegistryAddress: Address): Promise<IntegrationRegistry> {
    return await new IntegrationRegistry__factory(this._deployerSigner).attach(integrationRegistryAddress);
  }

  public async deployCKValuer(controller: Address): Promise<CKValuer> {
    return await new CKValuer__factory(this._deployerSigner).deploy(controller);
  }
}
