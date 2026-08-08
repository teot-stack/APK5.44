#!/usr/bin/env bash
set -euo pipefail
required=(
  settings.gradle
  build.gradle
  gradle.properties
  app/build.gradle
  app/src/main/AndroidManifest.xml
  app/src/main/java/com/riopintocoach/app/MainActivity.java
  app/src/main/assets/www/index.html
  app/src/main/assets/www/js/app.bundle.js
  .github/workflows/build-apk.yml
)
for file in "${required[@]}"; do
  [[ -f "$file" ]] || { echo "Falta: $file" >&2; exit 1; }
done
echo "Estructura Android/GitHub: OK"
