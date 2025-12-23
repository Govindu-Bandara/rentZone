# Download Lambda Functions Script for Windows
# PowerShell version

Write-Host "================================================" -ForegroundColor Cyan
Write-Host "Starting Lambda Functions Download" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

# Configuration
$AWS_REGION = "ap-south-1"
$OUTPUT_DIR = "lambda-functions"

# List of Lambda functions
$LAMBDAS = @(
    "rentzone-user-login",
    "rentzone-user-register",
    "rentzone-admin-login",
    "rentzone-admin-register",
    "rentzone-user-profile",
    "rentzone-house-create",
    "rentzone-house-update",
    "rentzone-house-delete",
    "rentzone-house-get",
    "rentzone-house-list",
    "rentzone-owner-listings",
    "rentzone-booking-request",
    "rentzone-owner-bookings",
    "rentzone-renter-bookings",
    "rentzone-payment-process",
    "rentzone-admin-verify-listings",
    "rentzone-admin-users",
    "rentzone-admin-fraud-monitoring",
    "rentzone-admin-system-logs",
    "rentzone-admin-dashboard-stats",
    "rentzone-owner-dashboard-stats",
    "rentzone-renter-dashboard-stats",
    "rentzone-favorites",
    "rentzone-recommendations",
    "rentzone-recently-viewed",
    "rentzone-get-messages",
    "rentzone-get-notifications",
    "rentzone-websocket-connect",
    "rentzone-websocket-disconnect",
    "rentzone-websocket-sendmessage",
    "rentzone-websocket-markasread",
    "rentzone-websocket-typing"
)

Write-Host "Found $($LAMBDAS.Count) Lambda functions to download" -ForegroundColor Green
Write-Host ""

$SUCCESSFUL = 0
$FAILED = 0
$FAILED_FUNCTIONS = @()

foreach ($LAMBDA_NAME in $LAMBDAS) {
    Write-Host "================================================" -ForegroundColor Yellow
    Write-Host "Processing: $LAMBDA_NAME" -ForegroundColor Yellow
    Write-Host "================================================" -ForegroundColor Yellow
    
    # Create directory
    $lambdaDir = Join-Path $OUTPUT_DIR $LAMBDA_NAME
    New-Item -ItemType Directory -Path $lambdaDir -Force | Out-Null
    
    try {
        # Get Lambda function
        Write-Host "Getting function details..." -ForegroundColor Cyan
        $functionInfo = aws lambda get-function --function-name $LAMBDA_NAME --region $AWS_REGION 2>&1
        
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to get function"
        }
        
        $functionJson = $functionInfo | ConvertFrom-Json
        $downloadUrl = $functionJson.Code.Location
        
        if (-not $downloadUrl) {
            throw "Could not get download URL"
        }
        
        # Download the code
        Write-Host "Downloading function code..." -ForegroundColor Cyan
        $zipPath = "$env:TEMP\$LAMBDA_NAME.zip"
        Invoke-WebRequest -Uri $downloadUrl -OutFile $zipPath
        
        # Extract
        Write-Host "Extracting code..." -ForegroundColor Cyan
        Expand-Archive -Path $zipPath -DestinationPath $lambdaDir -Force
        
        # Clean up
        Remove-Item $zipPath
        
        # Create package.json if not exists
        $packageJsonPath = Join-Path $lambdaDir "package.json"
        if (-not (Test-Path $packageJsonPath)) {
            Write-Host "Creating package.json..." -ForegroundColor Yellow
            
            $packageJson = @{
                name = $LAMBDA_NAME
                version = "1.0.0"
                description = "Lambda function for RentZone"
                main = "index.js"
                scripts = @{
                    test = "echo `"Error: no test specified`" && exit 1"
                }
                dependencies = @{
                    mongodb = "^6.3.0"
                    jsonwebtoken = "^9.0.2"
                    "@aws-sdk/client-ssm" = "^3.515.0"
                    "@aws-sdk/client-apigatewaymanagementapi" = "^3.515.0"
                    bcryptjs = "^2.4.3"
                }
                keywords = @("lambda", "rentzone")
                author = ""
                license = "ISC"
            } | ConvertTo-Json -Depth 10
            
            Set-Content -Path $packageJsonPath -Value $packageJson
        }
        
        # Create README
        $readmePath = Join-Path $lambdaDir "README.md"
        $readmeContent = @"
# $LAMBDA_NAME

Lambda function for RentZone platform.

## Description
This function handles: [Add description based on function name]

## Environment Variables
- ``MONGODB_URI_PARAM``: MongoDB connection string parameter
- ``JWT_SECRET``: JWT secret for authentication
- ``AWS_REGION``: AWS region (ap-south-1)

## Last Updated
$(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
"@
        Set-Content -Path $readmePath -Value $readmeContent
        
        Write-Host "✅ Successfully downloaded: $LAMBDA_NAME" -ForegroundColor Green
        $SUCCESSFUL++
        
    } catch {
        Write-Host "❌ Failed to download: $LAMBDA_NAME" -ForegroundColor Red
        Write-Host "Error: $_" -ForegroundColor Red
        $FAILED++
        $FAILED_FUNCTIONS += $LAMBDA_NAME
    }
    
    Write-Host ""
}

# Summary
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "DOWNLOAD SUMMARY" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Total functions: $($LAMBDAS.Count)" -ForegroundColor White
Write-Host "Successful: $SUCCESSFUL" -ForegroundColor Green
Write-Host "Failed: $FAILED" -ForegroundColor Red

if ($FAILED -gt 0) {
    Write-Host ""
    Write-Host "Failed functions:" -ForegroundColor Red
    foreach ($func in $FAILED_FUNCTIONS) {
        Write-Host "  - $func" -ForegroundColor Red
    }
}

Write-Host "========================================" -ForegroundColor Cyan

if ($FAILED -eq 0) {
    Write-Host "🎉 All Lambda functions downloaded successfully!" -ForegroundColor Green
    Write-Host "Location: $OUTPUT_DIR\" -ForegroundColor Green
} else {
    Write-Host "⚠️  Some functions failed to download. Please check the errors above." -ForegroundColor Yellow
}