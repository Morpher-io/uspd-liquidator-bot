export interface PriceData {
  price: string;
  dataTimestamp: number;
  requestTimestamp: number;
  assetPair: string;
  signature: string;
  decimals: number;
}

export class PriceService {
  private readonly priceApiUrl = 'https://uspd.io/api/v1/price/eth-usd';

  async getCurrentEthPrice(): Promise<PriceData> {
    try {
      const response = await fetch(this.priceApiUrl);
      if (!response.ok) {
        throw new Error(`Price API request failed: ${response.status} ${response.statusText}`);
      }
      
      const priceData: PriceData = await response.json();
      
      // Validate the response structure
      if (!priceData.price || !priceData.signature || !priceData.decimals) {
        throw new Error('Invalid price data structure received from API');
      }
      
      return priceData;
    } catch (error) {
      console.error('❌ Failed to fetch ETH price:', error);
      throw error;
    }
  }

  /**
   * Convert price string to number (accounting for decimals)
   */
  priceToNumber(priceData: PriceData): number {
    const priceWei = BigInt(priceData.price);
    const divisor = BigInt(10 ** priceData.decimals);
    return Number(priceWei) / Number(divisor);
  }

  /**
   * Check if price data is fresh (within acceptable time window)
   */
  isPriceDataFresh(priceData: PriceData, maxAgeMs: number = 60000): boolean {
    const now = Date.now();
    const priceAge = now - priceData.dataTimestamp;
    return priceAge <= maxAgeMs;
  }
}
