import 'dotenv/config'
import { createPublicClient, http, createWalletClient, webSocket, Address } from 'viem'
import { mainnet, sepolia } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'
import { PriceService } from './services/PriceService.js'
import { PositionService } from './services/PositionService.js'
import { LiquidationService } from './services/LiquidationService.js'
import { DeploymentService } from './services/DeploymentService.js'
import { AbiService } from './services/AbiService.js'

// Configuration - require all environment variables
const RPC_URL = process.env.RPC_URL
const WS_RPC_URL = process.env.WS_RPC_URL
const PRIVATE_KEY = process.env.PRIVATE_KEY as `0x${string}`
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY

// Network configuration
const CHAIN_ID = parseInt(process.env.CHAIN_ID || '1')
const LIQUIDATOR_NFT_ID = BigInt(process.env.LIQUIDATOR_NFT_ID || '0')

// Bot configuration
const MIN_PROFIT_THRESHOLD = process.env.MIN_PROFIT_THRESHOLD || '0.01'
const PRICE_UPDATE_INTERVAL = parseInt(process.env.PRICE_UPDATE_INTERVAL || '30000') // 30 seconds
const POSITION_UPDATE_INTERVAL = parseInt(process.env.POSITION_UPDATE_INTERVAL || '300000') // 5 minutes
const VERBOSE_LOGGING = process.env.VERBOSE_LOGGING === 'true' || process.argv.includes('--verbose')

// Validate required environment variables
if (!RPC_URL) {
  throw new Error('RPC_URL environment variable is required')
}
if (!WS_RPC_URL) {
  throw new Error('WS_RPC_URL environment variable is required')
}
if (!PRIVATE_KEY) {
  throw new Error('PRIVATE_KEY environment variable is required')
}
if (!ETHERSCAN_API_KEY) {
  throw new Error('ETHERSCAN_API_KEY environment variable is required')
}

// Determine chain
const chain = CHAIN_ID === 11155111 ? sepolia : mainnet;

// Set up clients
const publicClient = createPublicClient({
  chain,
  transport: http(RPC_URL),
})

const wsClient = createPublicClient({
  chain,
  transport: webSocket(WS_RPC_URL),
})

const walletClient = createWalletClient({
  chain,
  transport: http(RPC_URL),
  account: privateKeyToAccount(PRIVATE_KEY),
})

class USPDLiquidatorBot {
  private isRunning = false
  private deploymentService: DeploymentService
  private abiService: AbiService
  private priceService: PriceService
  private positionService: PositionService
  private liquidationService: LiquidationService
  private priceUpdateTimer?: NodeJS.Timeout
  private positionUpdateTimer?: NodeJS.Timeout
  private contractAddresses: any

  constructor() {
    this.deploymentService = new DeploymentService()
    this.abiService = new AbiService(ETHERSCAN_API_KEY!, CHAIN_ID)
    this.priceService = new PriceService()
    // Services will be initialized after fetching contract addresses
  }

  async start() {
    console.log('🚀 Starting USPD Liquidator Bot...')
    this.isRunning = true

    try {
      // Initialize services
      await this.initializeServices()

      // Start monitoring loops
      await this.startMonitoring()

      console.log('✅ USPD Liquidator Bot started successfully')
    } catch (error) {
      console.error('❌ Failed to start bot:', error)
      throw error
    }
  }

  async stop() {
    console.log('🛑 Stopping USPD Liquidator Bot...')
    this.isRunning = false

    // Clear timers
    if (this.priceUpdateTimer) {
      clearInterval(this.priceUpdateTimer)
    }
    if (this.positionUpdateTimer) {
      clearInterval(this.positionUpdateTimer)
    }

    // Stop event watchers
    this.eventUnwatchers.forEach(unwatch => {
      try {
        unwatch()
      } catch (error) {
        console.error('❌ Error stopping event watcher:', error)
      }
    })

    console.log('✅ Bot stopped successfully')
  }

  private async initializeServices() {
    console.log('🔧 Initializing services...')

    // Fetch contract deployments
    console.log('📡 Fetching USPD contract deployments...')
    await this.deploymentService.fetchDeployments()
    this.contractAddresses = this.deploymentService.getContractAddresses(CHAIN_ID)
    
    console.log('📋 Contract addresses:')
    console.log(`  Stabilizer NFT: ${this.contractAddresses.stabilizerNft}`)
    console.log(`  USPD Token: ${this.contractAddresses.uspdToken}`)
    console.log(`  Oracle: ${this.contractAddresses.oracle}`)

    // Initialize services with contract addresses
    this.positionService = new PositionService(
      publicClient, 
      this.contractAddresses.stabilizerNft,
      this.contractAddresses.stabilizerImpl,
      this.contractAddresses.positionEscrowImpl,
      this.contractAddresses.rateContract,
      this.abiService,
      LIQUIDATOR_NFT_ID
    )
    
    this.liquidationService = new LiquidationService(
      publicClient,
      walletClient,
      this.contractAddresses.stabilizerNft,
      this.contractAddresses.uspdToken,
      this.priceService,
      MIN_PROFIT_THRESHOLD
    )

    // Get initial block number
    const blockNumber = await publicClient.getBlockNumber()
    console.log(`📊 Current block: ${blockNumber}`)

    // Initialize position tracking
    console.log('🔍 Discovering and initializing positions...')
    await this.positionService.initializePositions()

    // Get initial price data and update positions
    const priceData = await this.priceService.getCurrentEthPrice()
    const ethPrice = this.priceService.priceToNumber(priceData)
    console.log(`💰 Current ETH price: $${ethPrice.toFixed(2)}`)

    // Update all positions with current price
    await this.positionService.updateAllPositions(priceData)

    // Log position statistics
    const stats = this.positionService.getPositionStats()
    console.log(`📊 Position stats: ${stats.active} active, ${stats.liquidatable} liquidatable, avg ratio: ${stats.averageCollateralization.toFixed(2)}%`)
  }

  private async startMonitoring() {
    console.log('👀 Starting monitoring loops...')

    // Start price monitoring
    this.startPriceMonitoring()

    // Start position monitoring
    this.startPositionMonitoring()

    // Watch for blockchain events
    await this.startEventWatching()

    // Handle graceful shutdown
    this.setupGracefulShutdown()
  }

  private startPriceMonitoring() {
    console.log(`📈 Starting price monitoring (interval: ${PRICE_UPDATE_INTERVAL}ms)`)
    
    this.priceUpdateTimer = setInterval(async () => {
      if (!this.isRunning) return

      try {
        const priceData = await this.priceService.getCurrentEthPrice()
        const ethPrice = this.priceService.priceToNumber(priceData)
        
        if (!this.priceService.isPriceDataFresh(priceData)) {
          console.warn('⚠️ Price data is stale')
        }

        // Log verbose information if enabled
        if (VERBOSE_LOGGING) {
          console.log(`💰 Current ETH price: $${ethPrice.toFixed(2)}`)
          
          // Get and log position statistics
          const stats = this.positionService.getPositionStats()
          console.log(`📊 Position stats: ${stats.active} active, ${stats.liquidatable} liquidatable, avg ratio: ${stats.averageCollateralization.toFixed(2)}%`)
          
          // Log individual position details
          this.logPositionDetails()
        }

        // Check for liquidation opportunities when price updates
        await this.checkLiquidationOpportunities(priceData)
      } catch (error) {
        console.error('❌ Price monitoring error:', error)
      }
    }, PRICE_UPDATE_INTERVAL)
  }

  private startPositionMonitoring() {
    console.log(`📊 Starting position monitoring (interval: ${POSITION_UPDATE_INTERVAL}ms)`)
    
    this.positionUpdateTimer = setInterval(async () => {
      if (!this.isRunning) return

      try {
        // Get current price for position updates
        const priceData = await this.priceService.getCurrentEthPrice()
        
        // Update all positions
        console.log('🔄 Updating all position data...')
        await this.positionService.updateAllPositions(priceData)
        
        // Log updated statistics
        const stats = this.positionService.getPositionStats()
        console.log(`📊 Updated positions: ${stats.active} active, ${stats.liquidatable} liquidatable, avg: ${stats.averageCollateralization.toFixed(2)}%`)
        
      } catch (error) {
        console.error('❌ Position monitoring error:', error)
      }
    }, POSITION_UPDATE_INTERVAL)
  }

  private async startEventWatching() {
    console.log('🎧 Starting blockchain event monitoring...')
    
    // Watch for new blocks
    const unwatch = wsClient.watchBlocks({
      onBlock: (block) => {
        if (!this.isRunning) return
        
        // Log every 100th block to avoid spam
        if (block.number % 100n === 0n) {
          console.log(`📦 Block ${block.number} (${new Date().toISOString()})`)
        }
      },
      onError: (error) => {
        console.error('❌ Block watching error:', error)
      }
    })

    // Watch for new Stabilizer NFT positions - we'll get the ABI from implementation
    const stabilizerAbi = await this.abiService.getContractAbi(this.contractAddresses.stabilizerImpl);
    const positionCreatedEvent = stabilizerAbi.find(item => 
      item.type === 'event' && item.name === 'StabilizerPositionCreated'
    );

    if (positionCreatedEvent) {
      const unwatchNFTCreation = wsClient.watchContractEvent({
        address: this.contractAddresses.stabilizerNft,
        abi: [positionCreatedEvent],
        eventName: 'StabilizerPositionCreated',
        onLogs: (logs) => {
          logs.forEach(async (log) => {
            const { tokenId, owner } = log.args;
            console.log(`➕ New Stabilizer Position created: ${tokenId} owned by ${owner}`);
            if (tokenId) {
              await this.positionService.addPosition(tokenId);
            }
          });
        },
        onError: (error) => {
          console.error('❌ NFT creation event error:', error)
        }
      })
      
      // Store unwatcher for cleanup
      this.eventUnwatchers.push(unwatchNFTCreation)
    }

    // Store unwatchers for cleanup
    this.eventUnwatchers.push(unwatch)
  }

  private eventUnwatchers: (() => void)[] = []

  private logPositionDetails() {
    const positions = this.positionService.getAllActivePositions()
    
    if (positions.length === 0) {
      console.log('📋 No active positions to display')
      return
    }

    console.log('📋 Active Position Details:')
    positions.forEach(position => {
      const status = position.isLiquidatable ? '🔴 LIQUIDATABLE' : '🟢 HEALTHY'
      const collateralEth = (Number(position.collateralAmount) / 1e18).toFixed(4)
      const debtUspd = (Number(position.uspdDebt) / 1e18).toFixed(2)
      
      console.log(`  NFT #${position.nftId}: ${status} | Ratio: ${position.collateralizationRatio.toFixed(2)}% | Collateral: ${position.collateralAmount} (${collateralEth} ETH) | Debt: ${position.uspdDebt} (${debtUspd} USPD)`)
    })
  }

  private async checkLiquidationOpportunities(priceData: any) {
    try {
      const liquidatablePositions = this.positionService.getLiquidatablePositions()
      
      if (liquidatablePositions.length === 0) {
        return
      }

      console.log(`🎯 Found ${liquidatablePositions.length} liquidatable positions`)

      // Process liquidations (limit concurrent liquidations)
      const maxConcurrentLiquidations = 3
      const positionsToProcess = liquidatablePositions.slice(0, maxConcurrentLiquidations)

      for (const position of positionsToProcess) {
        try {
          const result = await this.liquidationService.liquidatePosition(position, priceData)
          
          if (result.success) {
            console.log(`✅ Successfully liquidated position ${position.nftId}`)
            console.log(`💰 Profit: ${result.profit} ETH`)
          } else {
            console.log(`❌ Failed to liquidate position ${position.nftId}: ${result.error}`)
          }
        } catch (error) {
          console.error(`❌ Liquidation error for position ${position.nftId}:`, error)
        }
      }
    } catch (error) {
      console.error('❌ Error checking liquidation opportunities:', error)
    }
  }

  private setupGracefulShutdown() {
    const shutdown = async (signal: string) => {
      console.log(`\n🔄 Received ${signal}, shutting down gracefully...`)
      await this.stop()
      process.exit(0)
    }

    process.on('SIGINT', () => shutdown('SIGINT'))
    process.on('SIGTERM', () => shutdown('SIGTERM'))
  }
}

// Start the bot
async function main() {
  const bot = new USPDLiquidatorBot()
  await bot.start()
}

main().catch((error) => {
  console.error('💥 Fatal error:', error)
  process.exit(1)
})
