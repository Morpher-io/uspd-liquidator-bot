import { PublicClient, Address, parseUnits, keccak256, toBytes } from 'viem';
import { PriceData } from './PriceService.js';
import { AbiService } from './AbiService.js';

export interface StabilizerPosition {
  nftId: bigint;
  owner: Address;
  positionEscrowAddress: Address;
  collateralAmount: bigint;
  backedShares: bigint;
  uspdDebt: bigint;
  collateralizationRatio: number;
  isLiquidatable: boolean;
  liquidationThreshold: number;
  lastUpdated: number;
}

export class PositionService {
  private positions: Map<string, StabilizerPosition> = new Map();
  private positionEscrowAddresses: Map<string, Address> = new Map();
  private stabilizerNftAddress: Address;
  private positionEscrowImplAddress: Address;
  private publicClient: PublicClient;
  private liquidatorNftId: bigint;
  private abiService: AbiService;
  private stabilizerNftAbi: any[] = [];
  private positionEscrowAbi: any[] = [];

  constructor(
    publicClient: PublicClient, 
    stabilizerNftAddress: Address, 
    positionEscrowImplAddress: Address,
    abiService: AbiService,
    liquidatorNftId: bigint = 0n
  ) {
    this.publicClient = publicClient;
    this.stabilizerNftAddress = stabilizerNftAddress;
    this.positionEscrowImplAddress = positionEscrowImplAddress;
    this.abiService = abiService;
    this.liquidatorNftId = liquidatorNftId;
  }

  /**
   * Initialize positions by querying existing NFTs
   */
  async initializePositions(): Promise<void> {
    console.log('🔍 Initializing stabilizer positions...');
    
    try {
      // Load ABIs first
      await this.loadAbis();

      // Get total supply of Stabilizer NFTs
      const totalSupply = await this.publicClient.readContract({
        address: this.stabilizerNftAddress,
        abi: this.stabilizerNftAbi,
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
   * Load ABIs from cache or fetch from Etherscan
   */
  private async loadAbis(): Promise<void> {
    try {
      console.log('📋 Loading contract ABIs...');
      
      // Load Stabilizer NFT ABI
      this.stabilizerNftAbi = await this.abiService.getContractAbi(this.stabilizerNftAddress);
      
      // Load Position Escrow Implementation ABI
      this.positionEscrowAbi = await this.abiService.getContractAbi(this.positionEscrowImplAddress);
      
      console.log('✅ Contract ABIs loaded successfully');
    } catch (error) {
      console.error('❌ Failed to load ABIs:', error);
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
        abi: this.stabilizerNftAbi,
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
        abi: this.stabilizerNftAbi,
        functionName: 'ownerOf',
        args: [nftId]
      }) as Address;

      // Get position data from escrow
      const [collateralAmount, backedShares, uspdDebt] = await Promise.all([
        this.publicClient.readContract({
          address: positionEscrowAddress,
          abi: this.positionEscrowAbi,
          functionName: 'getCurrentStEthBalance'
        }),
        this.publicClient.readContract({
          address: positionEscrowAddress,
          abi: this.positionEscrowAbi,
          functionName: 'backedPoolShares'
        }),
        this.publicClient.readContract({
          address: positionEscrowAddress,
          abi: this.positionEscrowAbi,
          functionName: 'getUspdDebt'
        }).catch(() => 0n) // Fallback if method doesn't exist
      ]);

      // Store position
      const position: StabilizerPosition = {
        nftId,
        owner,
        positionEscrowAddress,
        collateralAmount: collateralAmount as bigint,
        backedShares: backedShares as bigint,
        uspdDebt: uspdDebt as bigint,
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
        abi: this.positionEscrowAbi,
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
