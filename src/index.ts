import 'dotenv/config'
import { createPublicClient, http, createWalletClient, webSocket } from 'viem'
import { mainnet } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'

// Configuration
const RPC_URL = process.env.RPC_URL || 'https://eth-mainnet.g.alchemy.com/v2/your-api-key'
const WS_RPC_URL = process.env.WS_RPC_URL || 'wss://eth-mainnet.g.alchemy.com/v2/your-api-key'
const PRIVATE_KEY = process.env.PRIVATE_KEY as `0x${string}`

// Set up clients
const publicClient = createPublicClient({
  chain: mainnet,
  transport: http(RPC_URL),
})

const wsClient = createPublicClient({
  chain: mainnet,
  transport: webSocket(WS_RPC_URL),
})

// Wallet client for transactions (if needed)
const walletClient = PRIVATE_KEY ? createWalletClient({
  chain: mainnet,
  transport: http(RPC_URL),
  account: privateKeyToAccount(PRIVATE_KEY),
}) : null

class LiquidatorBot {
  private isRunning = false

  async start() {
    console.log('🚀 Starting USPD Liquidator Bot...')
    this.isRunning = true

    // Get initial block number
    const blockNumber = await publicClient.getBlockNumber()
    console.log(`📊 Current block: ${blockNumber}`)

    // Start monitoring
    await this.startMonitoring()
  }

  async stop() {
    console.log('🛑 Stopping bot...')
    this.isRunning = false
  }

  private async startMonitoring() {
    console.log('👀 Starting contract monitoring...')
    
    // Example: Watch for new blocks
    const unwatch = wsClient.watchBlocks({
      onBlock: (block) => {
        if (!this.isRunning) return
        console.log(`📦 New block: ${block.number} (${new Date().toISOString()})`)
        this.processBlock(block)
      },
      onError: (error) => {
        console.error('❌ Block watching error:', error)
      }
    })

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\n🔄 Received SIGINT, shutting down gracefully...')
      unwatch()
      await this.stop()
      process.exit(0)
    })

    process.on('SIGTERM', async () => {
      console.log('\n🔄 Received SIGTERM, shutting down gracefully...')
      unwatch()
      await this.stop()
      process.exit(0)
    })
  }

  private async processBlock(block: any) {
    try {
      // TODO: Add your liquidation logic here
      // - Monitor specific contracts
      // - Check for liquidation opportunities
      // - Execute swaps on Uniswap
      
      // Example placeholder
      if (block.number % 100n === 0n) {
        console.log(`🔍 Checking liquidation opportunities at block ${block.number}`)
      }
    } catch (error) {
      console.error('❌ Error processing block:', error)
    }
  }
}

// Start the bot
async function main() {
  const bot = new LiquidatorBot()
  await bot.start()
}

main().catch((error) => {
  console.error('💥 Fatal error:', error)
  process.exit(1)
})
