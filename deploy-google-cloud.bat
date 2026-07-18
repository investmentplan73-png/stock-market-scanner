@echo off
echo ============================================
echo  Google Cloud Run Deployment Script
echo  Stock Market Options Scanner
echo ============================================
echo.

REM ---- CONFIGURATION ----
SET PROJECT_ID=stock-scanner-app
SET REGION=asia-south1
SET SERVICE_NAME=stock-scanner

REM ---- YOUR CREDENTIALS (Same as before - change if needed) ----
SET ADMIN_PASSWORD=admin@2024#pro
SET ADMIN_KEY=scanner2024

REM ---- SEED USERS: format = username:password:name:days ----
REM Add your users here (comma separated)
REM Example: user1:pass123:UserName:30,user2:pass456:User2:60
SET SEED_USERS=

echo.
echo Step 1: Setting project...
gcloud config set project %PROJECT_ID%

echo.
echo Step 2: Enabling required APIs...
gcloud services enable run.googleapis.com
gcloud services enable cloudbuild.googleapis.com
gcloud services enable artifactregistry.googleapis.com

echo.
echo Step 3: Building and deploying to Cloud Run...
gcloud run deploy %SERVICE_NAME% ^
  --source . ^
  --region %REGION% ^
  --platform managed ^
  --allow-unauthenticated ^
  --port 8080 ^
  --memory 512Mi ^
  --cpu 1 ^
  --min-instances 0 ^
  --max-instances 1 ^
  --timeout 300 ^
  --set-env-vars "PORT=8080,HOST=0.0.0.0,ADMIN_PASSWORD=%ADMIN_PASSWORD%,ADMIN_KEY=%ADMIN_KEY%,SEED_USERS=%SEED_USERS%,LOGIN_REQUIRED=true"

echo.
echo ============================================
echo  DEPLOYMENT COMPLETE!
echo ============================================
echo.
echo Your app URL will be shown above (something like):
echo   https://stock-scanner-xxxxx-xx.a.run.app
echo.
echo Admin Panel: YOUR_URL/admin.html?key=%ADMIN_KEY%
echo.
echo IMPORTANT: Free tier limits:
echo   - 2 million requests/month FREE
echo   - 360,000 GB-seconds compute FREE  
echo   - Server sleeps when no one uses it (cold start ~2-3 sec)
echo.
pause
