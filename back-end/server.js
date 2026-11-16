require('dotenv').config();

const app = require('./src/app');
const { startDeviceMonitor } = require('./src/services/deviceMonitor.service');

const PORT = process.env.PORT || 5000;

let stopMonitoringDevices;

const server = app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
    stopMonitoringDevices = startDeviceMonitor();
});

server.on('close', () => stopMonitoringDevices?.());
