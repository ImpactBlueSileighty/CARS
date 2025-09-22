# --- Stage 1: Build Stage ---
# Use an official Node.js image for an ARM64 architecture (for Raspberry Pi 3/4/5).
FROM --platform=linux/arm64 node:18-alpine AS builder

# Set the working directory inside the container.
WORKDIR /app

# Copy package.json and package-lock.json to leverage Docker cache.
COPY package*.json ./

# Install project dependencies.
RUN npm install

# Copy the rest of the application source code.
COPY . .

# --- Stage 2: Production Stage ---
# Use a smaller, lightweight base image for the final container.
FROM --platform=linux/arm64 node:18-alpine

WORKDIR /app

# Copy dependencies from the builder stage.
COPY --from=builder /app/node_modules ./node_modules

# Copy the application code from the builder stage.
COPY --from=builder /app .

# Expose the port the app runs on (update if you use a different port).
EXPOSE 3000

# Command to run the application.
CMD ["node", "server.js"]