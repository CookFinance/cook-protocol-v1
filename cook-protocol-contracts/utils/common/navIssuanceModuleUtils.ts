import { BigNumber } from "@ethersproject/bignumber";
import { Address } from "../types";
import { preciseMul, preciseMulCeil, preciseDiv, preciseDivCeil } from "./mathUtils";
import { PRECISE_UNIT } from "../constants";
import { CKToken, ICKValuer } from "../contracts";

export const getExpectedIssuePositionMultiplier = (
  previousPositionMultiplier: BigNumber,
  previousSupply: BigNumber,
  currentSupply: BigNumber
): BigNumber => {
  // Inflation = (currentSupply - previousSupply) / currentSupply
  const inflation = preciseDivCeil(currentSupply.sub(previousSupply), currentSupply);

  // previousPositionMultiplier * (1 - inflation %)
  return preciseMul(previousPositionMultiplier, PRECISE_UNIT.sub(inflation));
};

export const getExpectedCKTokenIssueQuantity = async(
  ckToken: CKToken,
  ckValuer: ICKValuer,
  reserveAsset: Address,
  reserveAssetBaseUnits: BigNumber,
  reserveAssetQuantity: BigNumber,
  managerFeePercentage: BigNumber,
  protocolDirectFeePercentage: BigNumber,
  premiumPercentage: BigNumber
): Promise<BigNumber> => {
  const ckTokenValuation = await ckValuer.calculateCKTokenValuation(ckToken.address, reserveAsset);
  const ckTokenSupply = await ckToken.totalSupply();

  const reserveQuantitySubFees = getExpectedPostFeeQuantity(
    reserveAssetQuantity,
    managerFeePercentage,
    protocolDirectFeePercentage
  );

  const reserveQuantitySubFeesAndPremium = reserveQuantitySubFees.sub(
    preciseMul(reserveQuantitySubFees, premiumPercentage)
  );

  const normalizedReserveQuantitySubFees = preciseDiv(reserveQuantitySubFees, reserveAssetBaseUnits);
  const normalizedReserveQuantitySubFeesAndPremium = preciseDiv(reserveQuantitySubFeesAndPremium, reserveAssetBaseUnits);

  const denominator = preciseMul(ckTokenSupply, ckTokenValuation)
    .add(normalizedReserveQuantitySubFees)
    .sub(normalizedReserveQuantitySubFeesAndPremium);

  return preciseDiv(preciseMul(normalizedReserveQuantitySubFeesAndPremium, ckTokenSupply), denominator);
};

export const getExpectedIssuePositionUnit = (
  previousUnits: BigNumber,
  issueQuantity: BigNumber,
  previousSupply: BigNumber,
  currentSupply: BigNumber,
  newPositionMultiplier: BigNumber,
  managerFeePercentage: BigNumber,
  protocolDirectFeePercentage: BigNumber
): BigNumber => {
  // Account for fees
  const issueQuantitySubFees = getExpectedPostFeeQuantity(
    issueQuantity,
    managerFeePercentage,
    protocolDirectFeePercentage
  );

  // (Previous supply * previous units + issueQuantitySubFees) / current supply
  const numerator = preciseMul(previousSupply, previousUnits).add(issueQuantitySubFees);
  const newPositionUnit = preciseDiv(numerator, currentSupply);

  // Adjust for rounding on the contracts when converting between real and virtual units
  const roundDownPositionUnit = preciseMul(newPositionUnit, newPositionMultiplier);
  return preciseDiv(roundDownPositionUnit, newPositionMultiplier);
};

export const getExpectedPostFeeQuantity = (
  quantity: BigNumber,
  managerFeePercentage: BigNumber,
  protocolDirectFeePercentage: BigNumber,
): BigNumber => {
  const managerFees = preciseMul(quantity, managerFeePercentage);
  const protocolDirectFees = preciseMul(quantity, protocolDirectFeePercentage);

  return quantity.sub(managerFees).sub(protocolDirectFees);
};

export const getExpectedReserveRedeemQuantity = (
  ckTokenQuantityToRedeem: BigNumber,
  ckTokenValuation: BigNumber,
  reserveAssetBaseUnits: BigNumber,
  managerFeePercentage: BigNumber,
  protocolDirectFeePercentage: BigNumber,
  premiumPercentage: BigNumber
): BigNumber => {
  const totalNotionalReserveQuantity = preciseMul(ckTokenValuation, ckTokenQuantityToRedeem);

  const totalPremium = preciseMulCeil(totalNotionalReserveQuantity, premiumPercentage);

  const totalNotionalReserveQuantitySubFees = getExpectedPostFeeQuantity(
    totalNotionalReserveQuantity.sub(totalPremium),
    managerFeePercentage,
    protocolDirectFeePercentage
  );

  return preciseMul(totalNotionalReserveQuantitySubFees, reserveAssetBaseUnits);
};

export const getExpectedRedeemPositionMultiplier = (
  previousPositionMultiplier: BigNumber,
  previousSupply: BigNumber,
  currentSupply: BigNumber
): BigNumber => {
  // Inflation = (previousSupply - currentSupply) / currentSupply
  const deflation = preciseDiv(previousSupply.sub(currentSupply), currentSupply);

  // previousPositionMultiplier * (1 + deflation %)
  return preciseMul(previousPositionMultiplier, PRECISE_UNIT.add(deflation));
};

export const getExpectedRedeemPositionUnit = (
  previousUnits: BigNumber,
  ckTokenQuantityToRedeem: BigNumber,
  ckTokenValuation: BigNumber,
  reserveAssetBaseUnits: BigNumber,
  previousSupply: BigNumber,
  currentSupply: BigNumber,
  newPositionMultiplier: BigNumber,
  managerFeePercentage: BigNumber,
  protocolDirectFeePercentage: BigNumber,
  premiumPercentage: BigNumber,
): BigNumber => {
  const totalNotionalReserveQuantity = preciseMul(ckTokenValuation, ckTokenQuantityToRedeem);

  const totalPremium = preciseMulCeil(totalNotionalReserveQuantity, premiumPercentage);

  const totalReserveBalance = preciseMul(totalNotionalReserveQuantity.sub(totalPremium), reserveAssetBaseUnits);

  // (Previous supply * previous units - reserveQuantityToRedeem) / current supply
  const numerator = preciseMul(previousSupply, previousUnits).sub(totalReserveBalance);
  const newPositionUnit = preciseDiv(numerator, currentSupply);
  // Adjust for rounding on the contracts when converting between real and virtual units
  const roundDownPositionUnit = preciseMul(newPositionUnit, newPositionMultiplier);
  return preciseDiv(roundDownPositionUnit, newPositionMultiplier);
};
