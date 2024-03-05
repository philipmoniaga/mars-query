import { Tendermint34Client } from "@cosmjs/tendermint-rpc";
import { rpc } from "./config";
import { RedBankProcessor } from "./RedBankProccesor";
import { QueryClient } from "@cosmjs/stargate";

async function makeTendermintClient(): Promise<QueryClient> {
  const client = QueryClient.withExtensions(
    await Tendermint34Client.connect(rpc)
  );
  return client;
}

async function start() {
  const client = await makeTendermintClient();

  const redBankProcessor = new RedBankProcessor(rpc, client);
  redBankProcessor.run();
}

start();
