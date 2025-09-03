import fs from 'fs/promises';
import path from 'path';
import { Address } from 'viem';

export interface ContractAbi {
  address: Address;
  abi: any[];
  lastUpdated: number;
}

export class AbiService {
  private readonly etherscanApiKey: string;
  private readonly chainId: number;
  private readonly abiCacheDir = './abi-cache';

  constructor(etherscanApiKey: string, chainId: number) {
    this.etherscanApiKey = etherscanApiKey;
    this.chainId = chainId;
  }

  /**
   * Get ABI for a contract address, fetching from cache or Etherscan
   */
  async getContractAbi(address: Address): Promise<any[]> {
    try {
      // Ensure cache directory exists
      await this.ensureCacheDir();

      const cacheFile = this.getCacheFilePath(address);
      
      // Try to load from cache first
      const cachedAbi = await this.loadFromCache(cacheFile);
      if (cachedAbi) {
        console.log(`📋 Using cached ABI for ${address}`);
        return cachedAbi.abi;
      }

      // Fetch from Etherscan
      console.log(`🔍 Fetching ABI for ${address} from Etherscan...`);
      const abi = await this.fetchAbiFromEtherscan(address);
      
      // Cache the result
      await this.saveToCache(cacheFile, { address, abi, lastUpdated: Date.now() });
      
      return abi;
    } catch (error) {
      console.error(`❌ Failed to get ABI for ${address}:`, error);
      throw error;
    }
  }

  /**
   * Fetch ABI from Etherscan API
   */
  private async fetchAbiFromEtherscan(address: Address): Promise<any[]> {
    const baseUrl = this.getEtherscanApiUrl();
    const url = `${baseUrl}?chainid=${this.chainId}&module=contract&action=getabi&address=${address}&apikey=${this.etherscanApiKey}`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Etherscan API request failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    
    if (data.status !== '1') {
      if (data.message === 'NOTOK' && data.result === 'Contract source code not verified') {
        throw new Error(`Contract ${address} is not verified on Etherscan`);
      }
      throw new Error(`Etherscan API error: ${data.message} - ${data.result}`);
    }

    try {
      return JSON.parse(data.result);
    } catch (parseError) {
      throw new Error(`Failed to parse ABI JSON for ${address}: ${parseError}`);
    }
  }

  /**
   * Get the appropriate Etherscan API URL for the chain
   */
  private getEtherscanApiUrl(): string {
    switch (this.chainId) {
      case 1: // Mainnet
        return 'https://api.etherscan.io/v2/api';
      case 11155111: // Sepolia
        return 'https://api-sepolia.etherscan.io/v2/api';
      default:
        throw new Error(`Unsupported chain ID for Etherscan: ${this.chainId}`);
    }
  }

  /**
   * Ensure the cache directory exists
   */
  private async ensureCacheDir(): Promise<void> {
    try {
      await fs.access(this.abiCacheDir);
    } catch {
      await fs.mkdir(this.abiCacheDir, { recursive: true });
    }
  }

  /**
   * Get cache file path for an address
   */
  private getCacheFilePath(address: Address): string {
    return path.join(this.abiCacheDir, `${address.toLowerCase()}.json`);
  }

  /**
   * Load ABI from cache file
   */
  private async loadFromCache(cacheFile: string): Promise<ContractAbi | null> {
    try {
      const data = await fs.readFile(cacheFile, 'utf-8');
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  /**
   * Save ABI to cache file
   */
  private async saveToCache(cacheFile: string, contractAbi: ContractAbi): Promise<void> {
    await fs.writeFile(cacheFile, JSON.stringify(contractAbi, null, 2));
  }

  /**
   * Clear cache for a specific address (useful when deployment changes)
   */
  async clearCache(address: Address): Promise<void> {
    const cacheFile = this.getCacheFilePath(address);
    try {
      await fs.unlink(cacheFile);
      console.log(`🗑️ Cleared cache for ${address}`);
    } catch {
      // File doesn't exist, nothing to do
    }
  }

  /**
   * Clear all cached ABIs
   */
  async clearAllCache(): Promise<void> {
    try {
      const files = await fs.readdir(this.abiCacheDir);
      await Promise.all(
        files
          .filter(file => file.endsWith('.json'))
          .map(file => fs.unlink(path.join(this.abiCacheDir, file)))
      );
      console.log('🗑️ Cleared all ABI cache');
    } catch (error) {
      console.error('❌ Failed to clear ABI cache:', error);
    }
  }
}
