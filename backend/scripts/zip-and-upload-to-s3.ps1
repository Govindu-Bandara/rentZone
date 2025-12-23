# Zip and Upload to S3 Script for Windows
# PowerShell version

Write-Host "================================================" -ForegroundColor Cyan
Write-Host "Starting ZIP and Upload Process" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

# Configuration
$AWS_REGION = "ap-south-1"
$S3_BUCKET = "rentzone-lambda-deployments"
$LAMBDA_DIR = "lambda-functions"

# Create dist directory
New-Item -ItemType Directory -Path "dist" -Force | Out-Null

# Get all Lambda function directories
$lambdaDirs = Get-ChildItem -Path $LAMBDA_DIR -Directory | Where-Object { $_.Name -like "rentzone-*" }

$SUCCESSFUL = 0
$FAILED = 0

Write-Host "Found $($lambdaDirs.Count) Lambda functions to process" -ForegroundColor Green
Write-Host ""

foreach ($dir in $lambdaDirs) {
    $LAMBDA_NAME = $dir.Name
    
    Write-Host "================================================" -ForegroundColor Yellow
    Write-Host "Processing: $LAMBDA_NAME" -ForegroundColor Yellow
    Write-Host "================================================" -ForegroundColor Yellow
    
    try {
        # Navigate to function directory
        Push-Location -Path (Join-Path $LAMBDA_DIR $LAMBDA_NAME)
        
        # Install dependencies
        Write-Host "Installing dependencies..." -ForegroundColor Cyan
        if (Test-Path "package.json") {
            npm install --production 2>$null
        }
        
        # Create ZIP file
        Write-Host "Creating ZIP package..." -ForegroundColor Cyan
        $zipPath = "..\..\dist\$LAMBDA_NAME.zip"
        
        # Remove old zip if exists
        if (Test-Path $zipPath) {
            Remove-Item $zipPath
        }
        
        # Create ZIP (exclude unnecessary files)
        $files = Get-ChildItem -Recurse | Where-Object { 
            $_.FullName -notmatch "\.git" -and 
            $_.FullName -notmatch "\.md$" -and 
            $_.FullName -notmatch "\\test\\" -and
            $_.Extension -ne ".zip"
        }
        
        Compress-Archive -Path * -DestinationPath $zipPath -Force
        
        Pop-Location
        
        # Get file size
        $fileSize = (Get-Item "dist\$LAMBDA_NAME.zip").Length / 1MB
        Write-Host "Package size: $([math]::Round($fileSize, 2)) MB" -ForegroundColor Cyan
        
        # Upload to S3
        Write-Host "Uploading to S3..." -ForegroundColor Cyan
        aws s3 cp "dist\$LAMBDA_NAME.zip" "s3://$S3_BUCKET/lambda-deployments/$LAMBDA_NAME.zip" --region $AWS_REGION
        
        if ($LASTEXITCODE -eq 0) {
            Write-Host "✅ Successfully uploaded: $LAMBDA_NAME" -ForegroundColor Green
            $SUCCESSFUL++
        } else {
            throw "S3 upload failed"
        }
        
    } catch {
        Write-Host "❌ Failed to process: $LAMBDA_NAME" -ForegroundColor Red
        Write-Host "Error: $_" -ForegroundColor Red
        $FAILED++
        Pop-Location -ErrorAction SilentlyContinue
    }
    
    Write-Host ""
}

# Summary
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "UPLOAD SUMMARY" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Successful: $SUCCESSFUL" -ForegroundColor Green
Write-Host "Failed: $FAILED" -ForegroundColor Red
Write-Host "========================================" -ForegroundColor Cyan

if ($FAILED -eq 0) {
    Write-Host "🎉 All Lambda functions uploaded to S3 successfully!" -ForegroundColor Green
    Write-Host "Bucket: s3://$S3_BUCKET/lambda-deployments/" -ForegroundColor Green
} else {
    Write-Host "⚠️  Some uploads failed. Please check the errors above." -ForegroundColor Yellow
}

# List uploaded files
Write-Host ""
Write-Host "Uploaded files in S3:" -ForegroundColor Cyan
aws s3 ls "s3://$S3_BUCKET/lambda-deployments/" --region $AWS_REGION