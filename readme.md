Force Refresh

node -e "
const StartupService = require('./services/StartupService');
const service = new StartupService();
service.initializeAllData(true).then(success => {
  console.log('Scan completed:', success);
  process.exit(0);
});
"


Build it


# Fix the unpacked folder
xcopy /E /I dist\win-unpacked\backend\node_modules dist\win-unpacked\resources\app\backend\node_modules

# Delete old portable
del dist\ExperimentAnalyzer-Portable.exe

# Rebuild ONLY the portable from the fixed unpacked folder
npx electron-builder --win portable --prepackaged dist\win-unpacked