# DemoAgents.md

This document details the implementation logic for the Demo Agents module within the Swarm Data Exchange Proof of Concept (POC), specifically utilizing the `swarm-elizaos-agent` framework. This framework allows ElizaOS AI agents to natively handle Swarm decentralized storage operations.

## 1. Agent Framework Setup (`swarm-elizaos-agent`)

Both the Provider (seller) and Consumer (buyer) agents will be built using the `swarm-elizaos-agent`, which natively equips them with tools to interact with the Swarm network.

To initialize the agents, their environment must be configured with the necessary Swarm and LLM provider connections:

```env
# Swarm Configuration
BEE_API_URL=http://localhost:1633 # URL to the local Bee node or Swarm Gateway
BEE_FEED_PK=your_private_key_here # Required to update Swarm feeds
AUTO_ASSIGN_STAMP=true # Automatically assigns a postage stamp to uploads

# LLM Configuration (Example using OpenAI)
OPENAI_API_KEY=sk-...
OPENAI_SMALL_MODEL=gpt-4o-mini
OPENAI_LARGE_MODEL=gpt-4o
```

By utilizing this framework, the agents inherently possess the capabilities to upload/download text, files, and folders, manage Swarm feeds, and autonomously create or extend postage stamp batches.

## 2. Provider Agent Logic (The Data Sellers)

Provider agents (e.g., an image-generating agent or a copy-trading log agent) generate valuable data and autonomously monetize it.

### 2.1. Data Generation and Swarm Upload

1.  **Generate Data:** The agent generates its target data based on its specific persona and instructions.
2.  **Purchase Storage:** If the agent needs storage, it uses its built-in `create_postage_stamp` capability to buy a postage stamp batch based on the required size and duration.
3.  **Upload with ACT:** The agent uses its upload tools (`upload_data` or `upload_file`) to push the data to Swarm. To ensure the data can be monetized, the upload is done through the local Bee node with the Access Control Trie (ACT) enabled, which encrypts the data at the chunk level.

### 2.2. ERC-8004 Identity Registration

The Provider Agent establishes its on-chain identity so consumers can discover and trust it.

1.  It generates an "Agent Registration File" (Agent Card) containing its description, capabilities, and endpoint URIs.
2.  It uploads this JSON file to Swarm using its built-in upload tools.
3.  It calls the ERC-8004 Identity Registry to mint its unique ERC-721 agent NFT, setting the `agentURI` to point to the Swarm hash of the registration file.

### 2.3. Serving Data via x402 Payments

The Provider Agent exposes an API endpoint protected by the x402 payment protocol.

1.  It runs a lightweight server (e.g., Express) utilizing the `@x402/express` middleware.
2.  When a consumer requests the data, the middleware intercepts it and returns an HTTP `402 Payment Required` challenge detailing the price in USDC, the recipient wallet, and the network.
3.  Once the x402 payment settles on-chain, the Provider Agent executes a post-payment action: adding the buyer's public key to the Swarm ACT grantee list and returning the encrypted Swarm reference.

## 3. Consumer Agent Logic (The Data Buyers)

Consumer agents programmatically discover providers, pay for data, and evaluate the results.

### 3.1. Discovery and Evaluation

1.  The agent queries the ERC-8004 Identity Registry or the SwarmDataHub indexer to discover providers offering the required data.
2.  Before purchasing, the agent checks the provider's trust score on the ERC-8004 Reputation Registry to ensure reliability.

### 3.2. Autonomous x402 Payment

1.  The Consumer Agent initiates a request to the Provider's endpoint.
2.  Using the `@x402/axios` library (which wraps the HTTP client), the agent automatically detects the `402 Payment Required` challenge.
3.  The client constructs an EIP-3009 signed payment payload and automatically retries the request with the `X-PAYMENT` header.

### 3.3. Data Retrieval via `swarm-elizaos-agent`

1.  Upon successful payment, the Consumer Agent receives the Swarm ACT reference.
2.  The agent uses its built-in `download_data` or `download_files` capabilities to fetch the content from Swarm.
3.  Because the fetch is routed through the Consumer's local Bee node, the node automatically derives the decryption keys from the ACT and decrypts the content transparently.

### 3.4. Reputation Feedback

After analyzing the retrieved data, the Consumer Agent interacts with the ERC-8004 Reputation Registry. It submits a feedback score (0-100) and an optional Swarm URI pointing to detailed evidence, completing the trust loop and aiding future agents in their discovery process.
