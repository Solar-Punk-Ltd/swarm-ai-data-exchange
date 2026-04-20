import "dotenv/config";
import express from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { type RoutesConfig } from "@x402/core/server";
import { grantActAccess } from "./act";

const app = express();

const PORT = process.env.PORT ?? 3000;
const PAYMENT_ADDRESS = process.env.PAYMENT_ADDRESS as `0x${string}`;
const NETWORK = (process.env.NETWORK ?? "eip155:84532") as `eip155:${number}`;
const PRICE = process.env.PRICE ?? "$0.001";
const FACILITATOR_URL = process.env.FACILITATOR_URL ?? "https://x402.org/facilitator";

const facilitatorClient = new HTTPFacilitatorClient({ url: FACILITATOR_URL });
const resourceServer = new x402ResourceServer(facilitatorClient)
  .register(NETWORK, new ExactEvmScheme());

const routes: RoutesConfig = {
  "GET /swarm/data/*": {
    accepts: {
      scheme: "exact",
      price: PRICE,
      network: NETWORK,
      payTo: PAYMENT_ADDRESS,
    },
    description: "Swarm ACT-encrypted data access",
  },
};

app.use("/swarm/data", (req, res, next) => {
  const publicKey = req.headers["swarm-public-key"];
  if (!publicKey || typeof publicKey !== "string") {
    res.status(400).json({ error: "Missing required header: swarm-public-key" });
    return;
  }
  next();
});

app.use(paymentMiddleware(routes, resourceServer));

app.get("/swarm/data/:swarmHash", async (req, res) => {
  const { swarmHash } = req.params;
  const publicKey = req.headers["swarm-public-key"];
  if (!publicKey || typeof publicKey !== "string") {
    res.status(400).json({ error: "Missing required header: swarm-public-key" });
    return;
  }
  try {
    const result = await grantActAccess(swarmHash, publicKey);
    res.json(result);
  } catch {
    res.status(500).json({ error: "ACT grant failed" });
  }
});

app.listen(PORT, () => {
  console.log(`x402 Swarm server listening on port ${PORT}`);
});
