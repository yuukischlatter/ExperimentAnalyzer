Force Refresh

node -e "
const StartupService = require('./services/StartupService');
const service = new StartupService();
service.initializeAllData(true).then(success => {
  console.log('Scan completed:', success);
  process.exit(0);
});
"