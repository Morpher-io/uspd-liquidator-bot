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
   * Format a token amount with human-readable value in parentheses
   */
  private formatTokenAmount(amount: bigint, decimals: number = 18, symbol: string = ''): string {
    const scaled = Number(amount) / Math.pow(10, decimals);
    return `${amount.toString()} ${symbol}(${scaled.toFixed(4)} ${symbol})`.trim();
  }

  /**
   * Format ETH amount with human-readable value
   */
  private formatEthAmount(amount: bigint): string {
    return this.formatTokenAmount(amount, 18, 'ETH ');
  }

  /**
   * Format USPD amount with human-readable value
   */
  private formatUspdAmount(amount: bigint): string {
    return this.formatTokenAmount(amount, 18, 'USPD ');
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
        console.log(`💰 Need ${this.formatUspdAmount(requiredUspd)} for liquidation`);
        return { success: false, error: 'Insufficient USPD balance' };
      }

      // 2. Calculate expected profit
      const expectedProfit = await this.calculateLiquidationProfit(position, priceData);
      
      if (expectedProfit < this.minProfitThreshold) {
        console.log(`📉 Liquidation profit too low: ${this.formatEthAmount(expectedProfit)}`);
        return { success: false, error: 'Profit below threshold' };
      }

      // 3. Execute liquidation transaction
      console.log(`💎 Expected profit: ${this.formatEthAmount(expectedProfit)}`);
      console.log(`💰 Required USPD: ${this.formatUspdAmount(requiredUspd)}`);
      
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
      console.log(`💰 ETH Price: $${ethPriceUsd.toFixed(2)}`);
      
      // Calculate collateral value in USD
      const collateralEth = Number(position.collateralAmount) / 1e18; // Convert from wei
      const collateralValueUsd = collateralEth * ethPriceUsd;
      console.log(`🏦 Collateral: ${collateralEth.toFixed(6)} ETH ($${collateralValueUsd.toFixed(2)})`);
      
      // Calculate debt value (USPD is pegged to USD)
      const debtValueUsd = Number(position.uspdDebt) / 1e18; // Assuming 18 decimals
      console.log(`💸 Debt: ${debtValueUsd.toFixed(2)} USPD ($${debtValueUsd.toFixed(2)})`);
      
      // Liquidation bonus (typically 5-10%)
      const liquidationBonusPercent = 5; // 5%
      const bonusValue = (debtValueUsd * liquidationBonusPercent) / 100;
      console.log(`🎁 Liquidation bonus (${liquidationBonusPercent}%): $${bonusValue.toFixed(2)}`);
      
      // Estimate gas costs (rough estimate)
      const estimatedGasCostEth = 0.01; // 0.01 ETH
      const estimatedGasCostUsd = estimatedGasCostEth * ethPriceUsd;
      console.log(`⛽ Estimated gas cost: ${estimatedGasCostEth} ETH ($${estimatedGasCostUsd.toFixed(2)})`);
      
      // Calculate net profit in USD
      const grossProfitUsd = bonusValue;
      const netProfitUsd = grossProfitUsd - estimatedGasCostUsd;
      console.log(`📊 Gross profit: $${grossProfitUsd.toFixed(2)}`);
      console.log(`📊 Net profit: $${netProfitUsd.toFixed(2)}`);
      
      // Convert back to ETH
      const netProfitEth = netProfitUsd / ethPriceUsd;
      console.log(`💎 Net profit in ETH: ${netProfitEth.toFixed(8)} ETH`);
      
      // Handle negative or very small profits
      if (netProfitEth <= 0) {
        console.log(`⚠️ Negative or zero profit, returning 0`);
        return 0n;
      }
      
      // Convert to wei, but handle precision issues
      const netProfitEthString = netProfitEth.toFixed(18); // Use full precision
      console.log(`🔢 Converting to wei: ${netProfitEthString} ETH`);
      
      const result = parseEther(netProfitEthString);
      console.log(`✅ Final result: ${this.formatEthAmount(result)}`);
      
      return result;
    } catch (error) {
      console.error('❌ Failed to calculate liquidation profit:', error);
      console.error('Error details:', error);
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
