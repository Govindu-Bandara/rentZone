#!/bin/bash

# Config
OUTPUT_DIR="lambdas"
REGION="ap-southeast-2"

mkdir -p "$OUTPUT_DIR"

echo "Fetching list of Lambda functions..."

FUNCTIONS=$(aws lambda list-functions \
  --region "$REGION" \
  --no-paginate \
  --query "Functions[*].FunctionName" \
  --output text)

for FUNC in $FUNCTIONS; do
  echo "Downloading: $FUNC"

  mkdir -p "$OUTPUT_DIR/$FUNC"

  # Get the pre-signed URL
  URL=$(aws lambda get-function \
    --function-name "$FUNC" \
    --region "$REGION" \
    --query "Code.Location" \
    --output text)

  # Download using curl with -L flag to follow redirects
 curl -L --ssl-no-revoke -o "$OUTPUT_DIR/$FUNC/$FUNC.zip" "$URL"

  # Check if zip was actually downloaded
  if [ -f "$OUTPUT_DIR/$FUNC/$FUNC.zip" ]; then
    unzip -q "$OUTPUT_DIR/$FUNC/$FUNC.zip" -d "$OUTPUT_DIR/$FUNC/"
    rm "$OUTPUT_DIR/$FUNC/$FUNC.zip"
    echo "✓ $FUNC extracted to $OUTPUT_DIR/$FUNC/"
  else
    echo "✗ FAILED to download $FUNC"
  fi

done

echo ""
echo "All Lambda functions downloaded into ./$OUTPUT_DIR/"