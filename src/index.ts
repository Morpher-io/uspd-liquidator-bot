import 'dotenv/config'
import { createPublicClient, http, createWalletClient, webSocket, Address } from 'viem'
import { mainnet } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'
import { PriceService } from './services/PriceService.js'
import { PositionService } from './services/PositionService.js'
import { LiquidationService } from './services/LiquidationService.js'

// Configuration - require all environment variables
const RPC_URL = process.env.RPC_URL
const WS_RPC_URL = process.env.WS_RPC_URL
const PRIVATE_KEY = process.env.PRIVATE_KEY as `0x${string}`

// Contract addresses
const STABILIZER_NFT_ADDRESS = process.env.STABILIZER_NFT_ADDRESS as Address
const USPD_TOKEN_ADDRESS = process.env.USPD_TOKEN_ADDRESS as Address
const PRICE_ORACLE_ADDRESS = process.env.PRICE_ORACLE_ADDRESS as Address

// Bot configuration
const MIN_PROFIT_THRESHOLD = process.env.MIN_PROFIT_THRESHOLD || '0.01'
const PRICE_UPDATE_INTERVAL = parseInt(process.env.PRICE_UPDATE_INTERVAL || '30000') // 30 seconds
const POSITION_UPDATE_INTERVAL = parseInt(process.env.POSITION_UPDATE_INTERVAL || '60000') // 1 minute

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
if (!STABILIZER_NFT_ADDRESS) {
  throw new Error('STABILIZER_NFT_ADDRESS environment variable is required')
}
if (!USPD_TOKEN_ADDRESS) {
  throw new Error('USPD_TOKEN_ADDRESS environment variable is required')
}

// Set up clients
const publicClient = createPublicClient({
  chain: mainnet,
  transport: http(RPC_URL),
})

const wsClient = createPublicClient({
  chain: mainnet,
  transport: webSocket(WS_RPC_URL),
})

const walletClient = createWalletClient({
  chain: mainnet,
  transport: http(RPC_URL),
  account: privateKeyToAccount(PRIVATE_KEY),
})

class USPDLiquidatorBot {
  private isRunning = false
  private priceService: PriceService
  private positionService: PositionService
  private liquidationService: LiquidationService
  private priceUpdateTimer?: NodeJS.Timeout
  private positionUpdateTimer?: NodeJS.Timeout

  constructor() {
    this.priceService = new PriceService()
    this.positionService = new PositionService(publicClient, STABILIZER_NFT_ADDRESS)
    this.liquidationService = new LiquidationService(
      publicClient,
      walletClient,
      STABILIZER_NFT_ADDRESS,
      USPD_TOKEN_ADDRESS,
      MIN_PROFIT_THRESHOLD
    )
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

    console.log('✅ Bot stopped successfully')
  }

  private async initializeServices() {
    console.log('🔧 Initializing services...')

    // Get initial block number
    const blockNumber = await publicClient.getBlockNumber()
    console.log(`📊 Current block: ${blockNumber}`)

    // Initialize position tracking
    await this.positionService.initializePositions()

    // Get initial price data
    const priceData = await this.priceService.getCurrentEthPrice()
    const ethPrice = this.priceService.priceToNumber(priceData)
    console.log(`💰 Current ETH price: $${ethPrice.toFixed(2)}`)
  }

  private async startMonitoring() {
    console.log('👀 Starting monitoring loops...')

    // Start price monitoring
    this.startPriceMonitoring()

    // Start position monitoring
    this.startPositionMonitoring()

    // Watch for blockchain events
    this.startEventWatching()

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
        const ethPrice = this.priceService.priceToNumber(priceData)

        // Update all positions (this would be optimized in production)
        console.log('🔄 Updating position data...')
        
        // TODO: Implement efficient position updates
        // In production, this would be event-driven rather than polling
      } catch (error) {
        console.error('❌ Position monitoring error:', error)
      }
    }, POSITION_UPDATE_INTERVAL)
  }

  private startEventWatching() {
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

    // TODO: Add specific contract event watching
    // - StabilizerNFT position changes
    // - USPD minting/burning events
    // - Price oracle updates
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
