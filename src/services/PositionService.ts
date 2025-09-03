import { PublicClient, Address, parseUnits, keccak256, toBytes } from 'viem';
import { PriceData } from './PriceService.js';

export interface StabilizerPosition {
  nftId: bigint;
  owner: Address;
  positionEscrowAddress: Address;
  collateralAmount: bigint;
  backedShares: bigint;
  collateralizationRatio: number;
  isLiquidatable: boolean;
  liquidationThreshold: number;
  lastUpdated: number;
}

// Basic ABI definitions - in production, these would be imported from generated types
const STABILIZER_NFT_ABI = [
  {
    name: 'totalSupply',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }]
  },
  {
    name: 'ownerOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ type: 'uint256' }],
    outputs: [{ type: 'address' }]
  },
  {
    name: 'positionEscrows',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ type: 'uint256' }],
    outputs: [{ type: 'address' }]
  },
  {
    name: 'StabilizerPositionCreated',
    type: 'event',
    inputs: [
      { name: 'tokenId', type: 'uint256', indexed: true },
      { name: 'owner', type: 'address', indexed: true }
    ]
  }
] as const;

const POSITION_ESCROW_ABI = [
  {
    name: 'getCurrentStEthBalance',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }]
  },
  {
    name: 'backedPoolShares',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }]
  },
  {
    name: 'getCollateralizationRatio',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ 
      type: 'tuple',
      components: [
        { name: 'price', type: 'uint256' },
        { name: 'decimals', type: 'uint8' },
        { name: 'dataTimestamp', type: 'uint256' },
        { name: 'assetPair', type: 'bytes32' },
        { name: 'signature', type: 'bytes' }
      ]
    }],
    outputs: [{ type: 'uint256' }]
  },
  {
    name: 'CollateralAdded',
    type: 'event',
    inputs: [
      { name: 'amount', type: 'uint256', indexed: false }
    ]
  },
  {
    name: 'CollateralRemoved',
    type: 'event',
    inputs: [
      { name: 'recipient', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false }
    ]
  },
  {
    name: 'AllocationModified',
    type: 'event',
    inputs: [
      { name: 'sharesDelta', type: 'int256', indexed: false },
      { name: 'newTotalShares', type: 'uint256', indexed: false }
    ]
  }
] as const;

export class PositionService {
  private positions: Map<string, StabilizerPosition> = new Map();
  private positionEscrowAddresses: Map<string, Address> = new Map();
  private stabilizerNftAddress: Address;
  private publicClient: PublicClient;
  private liquidatorNftId: bigint;

  constructor(publicClient: PublicClient, stabilizerNftAddress: Address, liquidatorNftId: bigint = 0n) {
    this.publicClient = publicClient;
    this.stabilizerNftAddress = stabilizerNftAddress;
    this.liquidatorNftId = liquidatorNftId;
  }

  /**
   * Initialize positions by querying existing NFTs
   */
  async initializePositions(): Promise<void> {
    console.log('🔍 Initializing stabilizer positions...');
    
    try {
      // Get total supply of Stabilizer NFTs
      const totalSupply = await this.publicClient.readContract({
        address: this.stabilizerNftAddress,
        abi: STABILIZER_NFT_ABI,
        functionName: 'totalSupply'
      });

      console.log(`📊 Found ${totalSupply} total Stabilizer NFTs`);

      // Query each NFT to get position data
      const batchSize = 10; // Process in batches to avoid RPC limits
      for (let i = 1n; i <= totalSupply; i += BigInt(batchSize)) {
        const batch = [];
        const endIndex = i + BigInt(batchSize) - 1n;
        const actualEnd = endIndex > totalSupply ? totalSupply : endIndex;

        for (let tokenId = i; tokenId <= actualEnd; tokenId++) {
          batch.push(this.initializePosition(tokenId));
        }

        await Promise.allSettled(batch);
        console.log(`📈 Processed NFTs ${i} to ${actualEnd}`);
      }

      const activePositions = Array.from(this.positions.values()).filter(p => p.backedShares > 0n);
      console.log(`📊 Initialized ${this.positions.size} total positions, ${activePositions.length} active`);
    } catch (error) {
      console.error('❌ Failed to initialize positions:', error);
      throw error;
    }
  }

  /**
   * Initialize a single position
   */
  private async initializePosition(nftId: bigint): Promise<void> {
    try {
      // Get position escrow address
      const positionEscrowAddress = await this.publicClient.readContract({
        address: this.stabilizerNftAddress,
        abi: STABILIZER_NFT_ABI,
        functionName: 'positionEscrows',
        args: [nftId]
      }) as Address;

      // Skip if no escrow address (shouldn't happen but safety check)
      if (positionEscrowAddress === '0x0000000000000000000000000000000000000000') {
        return;
      }

      // Get owner
      const owner = await this.publicClient.readContract({
        address: this.stabilizerNftAddress,
        abi: STABILIZER_NFT_ABI,
        functionName: 'ownerOf',
        args: [nftId]
      }) as Address;

      // Get position data from escrow
      const [collateralAmount, backedShares] = await Promise.all([
        this.publicClient.readContract({
          address: positionEscrowAddress,
          abi: POSITION_ESCROW_ABI,
          functionName: 'getCurrentStEthBalance'
        }),
        this.publicClient.readContract({
          address: positionEscrowAddress,
          abi: POSITION_ESCROW_ABI,
          functionName: 'backedPoolShares'
        })
      ]);

      // Store position
      const position: StabilizerPosition = {
        nftId,
        owner,
        positionEscrowAddress,
        collateralAmount: collateralAmount as bigint,
        backedShares: backedShares as bigint,
        collateralizationRatio: 0, // Will be calculated when price is available
        isLiquidatable: false,
        liquidationThreshold: this.calculateLiquidationThreshold(this.liquidatorNftId),
        lastUpdated: Date.now()
      };

      this.positions.set(nftId.toString(), position);
      this.positionEscrowAddresses.set(nftId.toString(), positionEscrowAddress);

    } catch (error) {
      console.error(`❌ Failed to initialize position ${nftId}:`, error);
    }
  }

  /**
   * Update position data with current price
   */
  async updatePosition(nftId: bigint, priceData: PriceData): Promise<void> {
    try {
      const position = this.positions.get(nftId.toString());
      if (!position) {
        console.warn(`⚠️ Position ${nftId} not found for update`);
        return;
      }

      // Create price query for contract call
      const priceQuery = {
        price: parseUnits(priceData.price, 0), // Price is already in wei format
        decimals: priceData.decimals,
        dataTimestamp: BigInt(Math.floor(priceData.dataTimestamp / 1000)),
        assetPair: keccak256(toBytes("ETH/USD")),
        signature: priceData.signature as `0x${string}`
      };

      // Get updated collateralization ratio from contract
      const ratioRaw = await this.publicClient.readContract({
        address: position.positionEscrowAddress,
        abi: POSITION_ESCROW_ABI,
        functionName: 'getCollateralizationRatio',
        args: [priceQuery]
      }) as bigint;

      // Convert ratio from basis points (10000 = 100%) to percentage
      const ratio = Number(ratioRaw) / 100;

      // Update position
      position.collateralizationRatio = ratio;
      position.isLiquidatable = ratio < position.liquidationThreshold && position.backedShares > 0n;
      position.lastUpdated = Date.now();

      this.positions.set(nftId.toString(), position);

      if (position.isLiquidatable) {
        console.log(`🎯 Position ${nftId} is liquidatable: ${ratio.toFixed(2)}% < ${position.liquidationThreshold}%`);
      }

    } catch (error) {
      console.error(`❌ Failed to update position ${nftId}:`, error);
    }
  }

  /**
   * Update all positions with current price
   */
  async updateAllPositions(priceData: PriceData): Promise<void> {
    const activePositions = Array.from(this.positions.values()).filter(p => p.backedShares > 0n);
    
    console.log(`🔄 Updating ${activePositions.length} active positions...`);

    // Update in batches to avoid overwhelming the RPC
    const batchSize = 5;
    for (let i = 0; i < activePositions.length; i += batchSize) {
      const batch = activePositions.slice(i, i + batchSize);
      const updatePromises = batch.map(pos => this.updatePosition(pos.nftId, priceData));
      
      await Promise.allSettled(updatePromises);
    }
  }

  /**
   * Get all positions that are eligible for liquidation
   */
  getLiquidatablePositions(): StabilizerPosition[] {
    return Array.from(this.positions.values()).filter(pos => pos.isLiquidatable);
  }

  /**
   * Get position by NFT ID
   */
  getPosition(nftId: bigint): StabilizerPosition | undefined {
    return this.positions.get(nftId.toString());
  }

  /**
   * Add a new position (called when monitoring events)
   */
  async addPosition(nftId: bigint): Promise<void> {
    console.log(`➕ Adding new position ${nftId} to monitoring`);
    await this.initializePosition(nftId);
  }

  /**
   * Calculate liquidation threshold based on liquidator's NFT ID
   */
  private calculateLiquidationThreshold(liquidatorTokenId: bigint): number {
    if (liquidatorTokenId === 0n) {
      return 110.00; // Default threshold (110%)
    }

    const baseThreshold = 125.00; // 125%
    const minThreshold = 110.00;  // 110%
    const decrement = Number(liquidatorTokenId - 1n) * 0.5; // 0.5% per ID

    const calculatedThreshold = baseThreshold - decrement;
    return Math.max(calculatedThreshold, minThreshold);
  }

  /**
   * Get position escrow addresses for event monitoring
   */
  getPositionEscrowAddresses(): Address[] {
    return Array.from(this.positionEscrowAddresses.values());
  }

  /**
   * Get statistics about monitored positions
   */
  getPositionStats(): {
    total: number;
    active: number;
    liquidatable: number;
    averageCollateralization: number;
  } {
    const allPositions = Array.from(this.positions.values());
    const activePositions = allPositions.filter(p => p.backedShares > 0n);
    const liquidatablePositions = allPositions.filter(p => p.isLiquidatable);
    
    const avgCollateralization = activePositions.length > 0 
      ? activePositions.reduce((sum, p) => sum + p.collateralizationRatio, 0) / activePositions.length
      : 0;

    return {
      total: allPositions.length,
      active: activePositions.length,
      liquidatable: liquidatablePositions.length,
      averageCollateralization: avgCollateralization
    };
  }
}
