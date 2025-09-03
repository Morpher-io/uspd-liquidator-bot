import { PublicClient, WalletClient, Address, parseEther } from 'viem';
import { StabilizerPosition } from './PositionService.js';
import { PriceData, PriceService } from './PriceService.js';

export interface LiquidationResult {
  success: boolean;
  txHash?: string;
  profit?: bigint;
  error?: string;
}

export class LiquidationService {
  private publicClient: PublicClient;
  private walletClient: WalletClient;
  private stabilizerNftAddress: Address;
  private uspdTokenAddress: Address;
  private minProfitThreshold: bigint;
  private priceService: PriceService;

  constructor(
    publicClient: PublicClient,
    walletClient: WalletClient,
    stabilizerNftAddress: Address,
    uspdTokenAddress: Address,
    priceService: PriceService,
    minProfitThreshold: string = '0.01' // ETH
  ) {
    this.publicClient = publicClient;
    this.walletClient = walletClient;
    this.stabilizerNftAddress = stabilizerNftAddress;
    this.uspdTokenAddress = uspdTokenAddress;
    this.priceService = priceService;
    this.minProfitThreshold = parseEther(minProfitThreshold);
  }

  /**
   * Attempt to liquidate a position
   */
  async liquidatePosition(
    position: StabilizerPosition,
    priceData: PriceData
  ): Promise<LiquidationResult> {
    try {
      console.log(`🎯 Attempting to liquidate position ${position.nftId}`);

      // 1. Check if we have enough USPD balance
      const requiredUspd = position.uspdDebt;
      const hasEnoughUspd = await this.checkUspdBalance(requiredUspd);
      
      if (!hasEnoughUspd) {
        console.log(`💰 Need ${requiredUspd} USPD for liquidation`);
        return { success: false, error: 'Insufficient USPD balance' };
      }

      // 2. Calculate expected profit
      const expectedProfit = await this.calculateLiquidationProfit(position, priceData);
      
      if (expectedProfit < this.minProfitThreshold) {
        console.log(`📉 Liquidation profit too low: ${expectedProfit} ETH`);
        return { success: false, error: 'Profit below threshold' };
      }

      // 3. Execute liquidation transaction
      console.log(`💎 Expected profit: ${expectedProfit} ETH`);
      console.log(`💰 Required USPD: ${requiredUspd}`);
      
      // TODO: Implement actual liquidation transaction
      // This would call StabilizerNFT.liquidatePosition()
      
      return {
        success: true,
        txHash: '0x...',
        profit: expectedProfit
      };

    } catch (error) {
      console.error(`❌ Liquidation failed for position ${position.nftId}:`, error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Check if we have enough USPD balance for liquidation
   */
  private async checkUspdBalance(requiredAmount: bigint): Promise<boolean> {
    try {
      // Query USPD token balance using ERC20 balanceOf
      const balance = await this.publicClient.readContract({
        address: this.uspdTokenAddress,
        abi: [
          {
            name: 'balanceOf',
            type: 'function',
            stateMutability: 'view',
            inputs: [{ type: 'address' }],
            outputs: [{ type: 'uint256' }]
          }
        ],
        functionName: 'balanceOf',
        args: [this.walletClient.account?.address]
      }) as bigint;

      return balance >= requiredAmount;
    } catch (error) {
      console.error('❌ Failed to check USPD balance:', error);
      return false;
    }
  }

  /**
   * Calculate expected profit from liquidation
   */
  private async calculateLiquidationProfit(
    position: StabilizerPosition,
    priceData: PriceData
  ): Promise<bigint> {
    try {
      // Convert price to number for calculations
      const ethPriceUsd = this.priceService.priceToNumber(priceData);
      
      // Calculate collateral value in USD
      const collateralEth = Number(position.collateralAmount) / 1e18; // Convert from wei
      const collateralValueUsd = collateralEth * ethPriceUsd;
      
      // Calculate debt value (USPD is pegged to USD)
      const debtValueUsd = Number(position.uspdDebt) / 1e18; // Assuming 18 decimals
      
      // Liquidation bonus (typically 5-10%)
      const liquidationBonusPercent = 5; // 5%
      const bonusValue = (debtValueUsd * liquidationBonusPercent) / 100;
      
      // Estimate gas costs (rough estimate)
      const estimatedGasCostEth = 0.01; // 0.01 ETH
      const estimatedGasCostUsd = estimatedGasCostEth * ethPriceUsd;
      
      // Calculate net profit in USD
      const grossProfitUsd = bonusValue;
      const netProfitUsd = grossProfitUsd - estimatedGasCostUsd;
      
      // Convert back to ETH
      const netProfitEth = netProfitUsd / ethPriceUsd;
      
      return parseEther(netProfitEth.toString());
    } catch (error) {
      console.error('❌ Failed to calculate liquidation profit:', error);
      return 0n;
    }
  }

  /**
   * Acquire USPD tokens (buy from DEX or mint)
   */
  private async acquireUspd(amount: bigint): Promise<boolean> {
    try {
      // TODO: Implement USPD acquisition strategy
      // Options:
      // 1. Buy from Uniswap/other DEX
      // 2. Mint new USPD (if system allows)
      // 3. Use existing balance
      
      console.log(`💱 Acquiring ${amount} USPD tokens`);
      return true;
    } catch (error) {
      console.error('❌ Failed to acquire USPD:', error);
      return false;
    }
  }
}
