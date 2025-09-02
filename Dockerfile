FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY . .

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S liquidator -u 1001

# Change ownership
RUN chown -R liquidator:nodejs /app
USER liquidator

# Expose port (if needed for health checks)
EXPOSE 3000

# Start the application
CMD ["npm", "run", "start:prod"]
