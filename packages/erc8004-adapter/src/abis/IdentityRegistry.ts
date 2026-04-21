export const IDENTITY_REGISTRY_ABI = [
  // Registration
  'function register(string calldata agentURI) external returns (uint256 agentId)',
  'function register(string calldata agentURI, tuple(string metadataKey, bytes metadataValue)[] calldata metadata) external returns (uint256 agentId)',
  'function register() external returns (uint256 agentId)',

  // URI management
  'function setAgentURI(uint256 agentId, string calldata newURI) external',
  'function tokenURI(uint256 tokenId) external view returns (string memory)',

  // Metadata
  'function getMetadata(uint256 agentId, string memory metadataKey) external view returns (bytes memory)',
  'function setMetadata(uint256 agentId, string memory metadataKey, bytes memory metadataValue) external',

  // Agent wallet verification (EIP-712)
  'function setAgentWallet(uint256 agentId, address newWallet, uint256 deadline, bytes calldata signature) external',
  'function getAgentWallet(uint256 agentId) external view returns (address)',
  'function unsetAgentWallet(uint256 agentId) external',

  // ERC-721
  'function ownerOf(uint256 tokenId) external view returns (address)',
  'function balanceOf(address owner) external view returns (uint256)',
  'function transferFrom(address from, address to, uint256 tokenId) external',

  // Events
  'event Registered(uint256 indexed agentId, string agentURI, address indexed owner)',
  'event URIUpdated(uint256 indexed agentId, string newURI, address indexed updatedBy)',
  'event MetadataSet(uint256 indexed agentId, string indexed indexedMetadataKey, string metadataKey, bytes metadataValue)',
] as const;
