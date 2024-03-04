import BigNumber from "bignumber.js";
import { CosmWasmClient } from "@cosmjs/cosmwasm-stargate";
import { Tendermint34Client } from "@cosmjs/tendermint-rpc";
import { QueryClient, StargateClient } from "@cosmjs/stargate";
import { toHex } from "@cosmjs/encoding";
import {
  QueryAllContractStateRequest,
  QueryAllContractStateResponse,
} from "cosmjs-types/cosmwasm/wasm/v1/query.js";
import { redbankAddress, oracleAddress, rpc } from "./config";
import { UserCollaterals, UserDebts, PriceUSD, AssetParams } from "./types";
import { hexToString, delay } from "./helper";

async function makeClient(
  rpcUrl: string
): Promise<[QueryClient, Tendermint34Client]> {
  const tmClient = await Tendermint34Client.connect(rpcUrl);
  return [QueryClient.withExtensions(tmClient), tmClient];
}

async function start() {
  let key = new Uint8Array();
  do {
    const resp = await queryAllContractState(redbankAddress, key);
    convertToAccountAddress(resp);
    key = resp.pagination?.nextKey || new Uint8Array();
  } while (key?.length > 0);
}

async function convertToAccountAddress(
  response: QueryAllContractStateResponse
) {
  for (const model of response.models) {
    const hexKey = toHex(model.key);
    const hexString = hexToString(hexKey);

    const mapName = hexString.substring(0, 8);

    if (mapName.includes("colls")) {
      const jsonAddress = JSON.parse(hexString.substring(9, 75)).addr;
      try {
        await processUserCollateralizationRatio(jsonAddress);
      } catch (error) {
        console.log(error);
      }

      // Wait for 1 second before processing the next model
      await delay(1000);
    }
  }
}

async function queryAllContractState(
  contractAddress: string,
  key: Uint8Array = new Uint8Array()
): Promise<QueryAllContractStateResponse> {
  const [client, _] = await makeClient(rpc);
  const request = QueryAllContractStateRequest.encode({
    address: contractAddress,
    pagination: {
      key: key,
      offset: 0n,
      limit: 100n,
      countTotal: false,
      reverse: false,
    },
  }).finish();
  const { value } = await client.queryAbci(
    "/cosmwasm.wasm.v1.Query/AllContractState",
    request
  );
  const response = QueryAllContractStateResponse.decode(value);

  return response;
}

async function queryUserCollaterals(
  wallet: string
): Promise<UserCollaterals[]> {
  const client = await CosmWasmClient.connect(rpc);
  const response = await client.queryContractSmart(redbankAddress, {
    user_collaterals: { user: wallet },
  });
  return response;
}

async function queryUserDebts(wallet: string): Promise<UserDebts[]> {
  const client = await CosmWasmClient.connect(rpc);
  const response = await client.queryContractSmart(redbankAddress, {
    user_debts: { user: wallet },
  });
  return response;
}

async function getAssetPriceUSD(denom: string): Promise<PriceUSD> {
  const client = await CosmWasmClient.connect(rpc);
  const response = await client.queryContractSmart(oracleAddress, {
    price: {
      denom: denom,
    },
  });
  return response;
}

async function getTokenDecimals(denom: string): Promise<AssetParams> {
  const client = await CosmWasmClient.connect(rpc);
  const response = await client.queryContractSmart(oracleAddress, {
    price_source: {
      denom: denom,
    },
  });
  return response;
}

async function processUserCollateralizationRatio(wallet: string) {
  const userDebts = await queryUserDebts(wallet);
  const userCollaterals = await queryUserCollaterals(wallet);

  let totalDebt = new BigNumber(0);
  let totalCollateral = new BigNumber(0);

  // Process debts
  const debtPromises = userDebts.map(async (debt) => {
    const denomPrice = await getAssetPriceUSD(debt.denom);
    const tokenDecimals = await getTokenDecimals(debt.denom);
    const denomDecimals = new BigNumber(10).pow(
      tokenDecimals.price_source.pyth.denom_decimals
    );
    const debtValue = new BigNumber(debt.amount)
      .div(denomDecimals)
      .times(denomPrice.price);
    return debtValue;
  });

  // Wait for all debt calculations to complete
  const debtValues = await Promise.all(debtPromises);
  totalDebt = debtValues.reduce((acc, val) => acc.plus(val), new BigNumber(0));

  // Process collaterals
  const collateralPromises = userCollaterals.map(async (collateral) => {
    const denomPrice = await getAssetPriceUSD(collateral.denom);
    const tokenDecimals = await getTokenDecimals(collateral.denom);
    const denomDecimals = new BigNumber(10).pow(
      tokenDecimals.price_source.pyth.denom_decimals
    );
    return new BigNumber(collateral.amount)
      .div(denomDecimals)
      .times(denomPrice.price);
  });

  // Wait for all collateral calculations to complete
  const collateralValues = await Promise.all(collateralPromises);
  totalCollateral = collateralValues.reduce(
    (acc, val) => acc.plus(val),
    new BigNumber(0)
  );

  // Log results
  console.log("User:", wallet);
  console.log("Total Debt:", totalDebt.toString());
  console.log("Total Collateral:", totalCollateral.toString());
  // Ensure you're not dividing by zero
  const collateralizationRatio = totalDebt.isZero()
    ? "Infinity"
    : totalCollateral.dividedBy(totalDebt).toString();
  console.log("Collateralization Ratio:", collateralizationRatio);
  console.log("=====================================");
}

let isStartInProgress = false;
let lastProcessedHeight = 0;

async function monitorNewBlocksAndStart() {
  const client = await StargateClient.connect(rpc);

  console.log("Starting block monitoring...");

  setInterval(async () => {
    try {
      const currentHeight = await client.getHeight();

      // Check if there's a new block and if start is not already in progress
      if (currentHeight > lastProcessedHeight && !isStartInProgress) {
        console.log(`New block detected! Height: ${currentHeight}`);
        lastProcessedHeight = currentHeight; // Update the last processed height
        isStartInProgress = true; // Indicate that processing is starting

        await start(); // Call start for processing

        isStartInProgress = false; // Reset the flag once processing completes
      }
    } catch (error) {
      console.error("Error during block monitoring:", error);
      isStartInProgress = false; // Ensure flag is reset in case of an error
    }
  }, 1000); // Adjust based on the block time of your blockchain
}

monitorNewBlocksAndStart();
