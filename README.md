# Chalo On Tour Backend

Backend API server for Chalo On Tour CRM system.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create a `.env` file with the following variables:
```
MONGODB_URI=your_mongodb_connection_string
PORT=5000
CLIENT_URL=your_frontend_url
JWT_SECRET=your_jwt_secret_key
JWT_EXPIRE=7d
NODE_ENV=development
```

### Required Environment Variables:
- **MONGODB_URI** - MongoDB connection string (e.g., `mongodb+srv://user:pass@cluster.mongodb.net/dbname`)
- **CLIENT_URL** - Frontend URL for CORS (can be comma-separated for multiple URLs)
- **JWT_SECRET** - Secret key for JWT token signing (use a strong random string)

### Optional Environment Variables:
- **PORT** - Server port (defaults to 5000)
- **JWT_EXPIRE** - JWT token expiration time (defaults to '7d')
- **NODE_ENV** - Environment mode: 'development' or 'production'

3. Start the server:
```bash
# Development
npm run dev

# Production
npm start
```

## Deployment

### Vercel Deployment

1. Connect your GitHub repository to Vercel
2. Set environment variables in Vercel dashboard
3. Build command: `npm install`
4. Output directory: (leave empty for serverless)
5. Install command: `npm install`

### Render Deployment

1. Create a new Web Service on Render
2. Connect your GitHub repository: `https://github.com/anamika7078/Chalo_on_Tour_Server.git`
3. Build command: `npm install`
4. Start command: `npm start`
5. Set the following environment variables in Render dashboard:

**Required Environment Variables:**
- `MONGODB_URI` - Your MongoDB Atlas connection string
- `CLIENT_URL` - Your frontend URL (e.g., `https://your-frontend.onrender.com`)
- `JWT_SECRET` - A strong random string for JWT signing (generate with: `openssl rand -base64 32`)

**Optional Environment Variables:**
- `PORT` - Server port (Render auto-assigns, but you can set it)
- `JWT_EXPIRE` - Token expiration (default: `7d`)
- `NODE_ENV` - Set to `production`

**Note:** The `render.yaml` file is included for automatic configuration. If using Render Blueprint, it will auto-detect these settings.

### Railway Deployment

1. Create a new project on Railway
2. Connect your GitHub repository
3. Railway will auto-detect Node.js
4. Set environment variables in Railway dashboard

## API Endpoints

- `/api/auth/*` - Authentication routes
- `/api/leads/*` - Lead management routes
- `/api/users/*` - User management routes
- `/api/stats/*` - Statistics routes

## Default Users

- Super Admin: `sadmin@gmail.com` / `123456`
- Staff: `staff@gmail.com` / `123456`

## Notes

- Make sure MongoDB connection string is set correctly
- CORS is configured for localhost:3000 and localhost:3001 by default
- For production, set `CLIENT_URL` environment variable

