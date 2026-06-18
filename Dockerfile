FROM node:22-alpine

WORKDIR /app

# Install deps first for layer caching
COPY package*.json ./
RUN npm install

# App source (node_modules/.env excluded via .dockerignore)
COPY . .

EXPOSE 3002

# Default = API. The worker service overrides this with `command: npm run worker`.
CMD ["npm", "run", "dev"]
