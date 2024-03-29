import * as dotenv from "dotenv";
dotenv.config();

export const redbankAddress =
  "osmo1c3ljch9dfw5kf52nfwpxd2zmj2ese7agnx0p9tenkrryasrle5sqf3ftpg";

export const oracleAddress =
  "osmo1mhznfr60vjdp2gejhyv2gax9nvyyzhd3z0qcwseyetkfustjauzqycsy2g";

export const rpc = process.env.RPC || "https://rpc-osmosis.blockfrost.io:443"; // Osmosis RPC
