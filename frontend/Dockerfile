# Stage 1: Build the React application
FROM node:20-alpine AS build

WORKDIR /app

# Copy package files and install dependencies for caching
COPY package.json package-lock.json ./
RUN npm install

# Copy the rest of the source and build the app
COPY . .
RUN npm run build

# Stage 2: Serve the application with Nginx
FROM nginx:stable-alpine

# Copy built artifacts from the first stage
COPY --from=build /app/dist /usr/share/nginx/html

# Copy custom Nginx configuration to handle routing and proxying
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expose port 80
EXPOSE 80

# Start Nginx
CMD ["nginx", "-g", "daemon off;"]
