import BigNumber from "bignumber.js";
import { CosmWasmClient } from "@cosmjs/cosmwasm-stargate";

import { QueryClient, StargateClient } from "@cosmjs/stargate";
import { toHex } from "@cosmjs/encoding";
import {
  QueryAllContractStateRequest,
  QueryAllContractStateResponse,
} from "cosmjs-types/cosmwasm/wasm/v1/query.js";
import { redbankAddress, oracleAddress } from "./config";
import { UserCollaterals, UserDebts, PriceUSD, AssetParams } from "./types";
import { hexToString, delay } from "./helper";

export class RedBankProcessor {
  private rpcUrl: string;
  private client: QueryClient;
  private isStartInProgress: boolean;
  private lastProcessedHeight: number;

  constructor(rpcUrl: string, client: QueryClient) {
    this.rpcUrl = rpcUrl;
    this.client = client;
    this.isStartInProgress = false;
    this.lastProcessedHeight = 0;
  }

  private async queryAllContractState(
    contractAddress: string,
    key: Uint8Array = new Uint8Array()
  ): Promise<QueryAllContractStateResponse> {
    const request = QueryAllContractStateRequest.encode({
      address: contractAddress,
      pagination: {
        key: key,
        offset: BigInt(0),
        limit: BigInt(100),
        countTotal: false,
        reverse: false,
      },
    }).finish();
    const { value } = await this.client.queryAbci(
      "/cosmwasm.wasm.v1.Query/AllContractState",
      request
    );
    const response = QueryAllContractStateResponse.decode(value);

    return response;
  }

  private async convertToAccountAddress(
    response: QueryAllContractStateResponse
  ): Promise<void> {
    for (const model of response.models) {
      const hexKey = toHex(model.key);
      const hexString = hexToString(hexKey);

      const mapName = hexString.substring(0, 8);

      if (mapName.includes("colls")) {
        const jsonAddress = JSON.parse(hexString.substring(9, 75)).addr;
        try {
          await this.processUserCollateralizationRatio(jsonAddress);
        } catch (error) {
          console.log(error);
        }

        // Wait for 1 second before processing the next model
        await delay(1000);
      }
    }
  }

  private async processUserCollateralizationRatio(
    wallet: string
  ): Promise<void> {
    const userDebts = await this.queryUserDebts(wallet);
    const userCollaterals = await this.queryUserCollaterals(wallet);

    let totalDebt = new BigNumber(0);
    let totalCollateral = new BigNumber(0);

    // Process debts
    const debtPromises = userDebts.map(async (debt) => {
      const denomPrice = await this.getAssetPriceUSD(debt.denom);
      const tokenDecimals = await this.getTokenDecimals(debt.denom);
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
    totalDebt = debtValues.reduce(
      (acc, val) => acc.plus(val),
      new BigNumber(0)
    );

    // Process collaterals
    const collateralPromises = userCollaterals.map(async (collateral) => {
      const denomPrice = await this.getAssetPriceUSD(collateral.denom);
      const tokenDecimals = await this.getTokenDecimals(collateral.denom);
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

  private async queryUserCollaterals(
    wallet: string
  ): Promise<UserCollaterals[]> {
    const client = await CosmWasmClient.connect(this.rpcUrl);
    const response = await client.queryContractSmart(redbankAddress, {
      user_collaterals: { user: wallet },
    });
    return response;
  }

  private async queryUserDebts(wallet: string): Promise<UserDebts[]> {
    const client = await CosmWasmClient.connect(this.rpcUrl);
    const response = await client.queryContractSmart(redbankAddress, {
      user_debts: { user: wallet },
    });
    return response;
  }

  private async getAssetPriceUSD(denom: string): Promise<PriceUSD> {
    const client = await CosmWasmClient.connect(this.rpcUrl);
    const response = await client.queryContractSmart(oracleAddress, {
      price: {
        denom: denom,
      },
    });
    return response;
  }

  private async getTokenDecimals(denom: string): Promise<AssetParams> {
    const client = await CosmWasmClient.connect(this.rpcUrl);
    const response = await client.queryContractSmart(oracleAddress, {
      price_source: {
        denom: denom,
      },
    });
    return response;
  }

  private async start(): Promise<void> {
    let key = new Uint8Array();
    do {
      const resp = await this.queryAllContractState(redbankAddress, key);
      await this.convertToAccountAddress(resp);
      key = resp.pagination?.nextKey || new Uint8Array();
    } while (key?.length > 0);
  }

  private async monitorNewBlocksAndStart(): Promise<void> {
    const client = await StargateClient.connect(this.rpcUrl);

    console.log("Starting block monitoring...");

    setInterval(async () => {
      try {
        const currentHeight = await client.getHeight();

        // Check if there's a new block and if start is not already in progress
        if (
          currentHeight > this.lastProcessedHeight &&
          !this.isStartInProgress
        ) {
          console.log(`New block detected! Height: ${currentHeight}`);
          this.lastProcessedHeight = currentHeight; // Update the last processed height
          this.isStartInProgress = true; // Indicate that processing is starting

          await this.start(); // Call start for processing

          this.isStartInProgress = false; // Reset the flag once processing completes
        }
      } catch (error) {
        console.error("Error during block monitoring:", error);
        this.isStartInProgress = false; // Ensure flag is reset in case of an error
      }
    }, 1000); // Adjust based on the block time of your blockchain
  }

  public async run(): Promise<void> {
    await this.monitorNewBlocksAndStart();
  }
}
