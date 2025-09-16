import { Address } from 'viem';

export interface USPDDeployment {
  chainId: number;
  deployment: {
    contracts: {
      oracleImpl: Address;
      oracle: Address;
      stabilizerImpl: Address;
      stabilizer: Address;
      cuspdToken: Address;
      uspdToken: Address;
      rateContract: Address;
      reporterImpl: Address;
      reporter: Address;
      insuranceEscrow: Address;
      bridgeEscrow: Address;
      stabilizerEscrowImpl: Address;
      positionEscrowImpl: Address;
    };
    config: {
      usdcAddress: Address;
      uniswapRouter: Address;
      chainlinkAggregator: Address;
      lidoAddress: Address;
      stETHAddress: Address;
      stabilizerBaseURI: string;
    };
  };
  metadata: {
    chainId: number;
    deploymentTimestamp: number;
    deployer: Address;
  };
}

export class DeploymentService {
  private readonly deploymentsApiUrl = 'https://uspd.io/api/deployments';
  private deployments: USPDDeployment[] = [];

  async fetchDeployments(): Promise<USPDDeployment[]> {
    try {
      const response = await fetch(this.deploymentsApiUrl);
      if (!response.ok) {
        throw new Error(`Deployments API request failed: ${response.status} ${response.statusText}`);
      }
      
      this.deployments = await response.json();
      return this.deployments;
    } catch (error) {
      console.error('❌ Failed to fetch deployments:', error);
      throw error;
    }
  }

  getDeploymentForChain(chainId: number): USPDDeployment | undefined {
    return this.deployments.find(d => d.chainId === chainId);
  }

  getContractAddresses(chainId: number) {
    const deployment = this.getDeploymentForChain(chainId);
    if (!deployment) {
      throw new Error(`No deployment found for chain ID ${chainId}`);
    }
    
    return {
      stabilizerNft: deployment.deployment.contracts.stabilizer,
      stabilizerImpl: deployment.deployment.contracts.stabilizerImpl,
      uspdToken: deployment.deployment.contracts.uspdToken,
      cuspdToken: deployment.deployment.contracts.cuspdToken,
      oracle: deployment.deployment.contracts.oracle,
      reporter: deployment.deployment.contracts.reporter,
      insuranceEscrow: deployment.deployment.contracts.insuranceEscrow,
      positionEscrowImpl: deployment.deployment.contracts.positionEscrowImpl,
      rateContract: deployment.deployment.contracts.rateContract,
      stETHAddress: deployment.deployment.config.stETHAddress,
      uniswapRouter: deployment.deployment.config.uniswapRouter,
    };
  }
}
