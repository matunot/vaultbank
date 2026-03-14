# Free Deployment Guide for VaultBank

This guide provides step-by-step instructions for deploying VaultBank to Vercel (frontend) and Railway (backend) using their free tiers.

## 🎯 Overview

- **Frontend**: React.js application deployed to Vercel
- **Backend**: Node.js/Express API deployed to Railway
- **Database**: MongoDB Atlas (free tier)

## 🚀 Frontend Deployment to Vercel

### Framework Preset

- **Preset**: Create React App (CRA)
- **Build Command**: `npm run build`
- **Output Directory**: `build`
- **Install Command**: `npm install`

### Environment Variables

Add these environment variables in your Vercel project settings:

```
REACT_APP_API_BASE_URL=https://your-railway-backend-url.railway.app
```

### Deployment Steps

1. **Sign up** for Vercel: [https://vercel.com/signup](https://vercel.com/signup)
2. **Install Vercel CLI** (optional for local testing):
   ```bash
   npm install -g vercel
   ```
3. **Deploy from GitHub**:

   - Connect your GitHub repository to Vercel
   - Select the `client` directory as the root
   - Set framework preset to "Create React App"
   - Add the environment variable above
   - Click "Deploy"

4. **Verify deployment**:
   - Your frontend will be available at `https://your-project-name.vercel.app`
   - Check the deployment logs for any build errors

## 🛤️ Backend Deployment to Railway

### Start Command

```
node index.js
```

### Environment Variables

Add these environment variables in your Railway project settings:

```
# Required
MONGODB_URI=mongodb+srv://<username>:<password>@cluster0.mongodb.net/vaultbank?retryWrites=true&w=majority
JWT_SECRET=your-strong-secret-key-here
JWT_REFRESH_SECRET=your-strong-refresh-secret-key-here
NODE_ENV=production
PORT=5000

# Optional but recommended
FRONTEND_URL=https://your-vercel-frontend.vercel.app
PAYPAL_CLIENT_ID=your-paypal-client-id
PAYPAL_SECRET=your-paypal-secret
EXCHANGE_RATE_API_KEY=your-exchange-rate-api-key
BCRYPT_ROUNDS=12
```

### Deployment Steps

1. **Sign up** for Railway: [https://railway.app/signup](https://railway.app/signup)
2. **Create a new project** and select "Deploy from GitHub repo"
3. **Configure your service**:
   - Select the `server` directory as the root
   - Set start command to: `node index.js`
   - Add all environment variables listed above
4. **Add MongoDB**:
   - In Railway dashboard, go to "Variables" tab
   - Click "New" and select "MongoDB"
   - Railway will automatically provision a MongoDB instance and set the `MONGODB_URI`
5. **Deploy**:
   - Click "Deploy"
   - Monitor logs for any startup errors

## 🔗 Connecting Frontend and Backend

1. After both services are deployed:

   - Copy the Railway backend URL (e.g., `https://your-backend-production.up.railway.app`)
   - Update the `REACT_APP_API_BASE_URL` in Vercel environment variables
   - Redeploy the frontend

2. Update CORS settings in backend:
   - Set `FRONTEND_URL` in Railway environment variables to your Vercel frontend URL

## 🏥 Health Check Endpoints

- **Frontend**: `https://your-frontend.vercel.app` (should load without errors)
- **Backend**: `https://your-backend.railway.app/health` (should return 200 with status JSON)

## 📝 Notes

1. **Free Tier Limitations**:

   - Vercel: 100GB bandwidth/month, unlimited deployments
   - Railway: $5/month free credits, sleeps after inactivity
   - MongoDB Atlas: 512MB storage free tier

2. **Security**:

   - Never commit `.env` files to GitHub
   - Use strong, unique secrets for JWT tokens
   - Rotate API keys regularly

3. **Troubleshooting**:
   - Check Railway logs for backend errors
   - Verify CORS settings if frontend can't connect to backend
   - Ensure all environment variables are correctly set

## 🎉 Next Steps

1. Set up custom domain (optional)
2. Configure CI/CD for automatic deployments
3. Set up monitoring and alerts
4. Implement backup strategy for MongoDB

Happy deploying! 🚀
