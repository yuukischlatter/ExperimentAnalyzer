/**
 * Electron Main Process
 * Entry point for the Electron application
 */

const { app, BrowserWindow, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const isDev = require('electron-is-dev');

// Set environment variable for backend to detect Electron
process.env.ELECTRON = 'true';

let mainWindow = null;
let backendServer = null;
let serverPort = 5001; // Different from default backend port

/**
 * Check if R: drive is accessible
 */
function checkRDriveAccess() {
    const rDrivePath = 'R:\\Schweissungen';
    
    try {
        // Check if R: drive exists
        if (!fs.existsSync('R:\\')) {
            return {
                success: false,
                error: 'R: drive not found',
                details: 'The R: drive is not mapped on this system.'
            };
        }
        
        // Check if Schweissungen folder exists
        if (!fs.existsSync(rDrivePath)) {
            return {
                success: false,
                error: 'Schweissungen folder not found',
                details: `Cannot find folder: ${rDrivePath}`
            };
        }
        
        // Test read access
        fs.readdirSync(rDrivePath);
        
        return { success: true };
        
    } catch (error) {
        return {
            success: false,
            error: 'R: drive access failed',
            details: error.message
        };
    }
}

/**
 * Start the backend server
 */
async function startBackendServer() {
    try {
        console.log('Starting backend server...');
        
        // Set the server port
        process.env.PORT = serverPort;
        process.env.HOST = 'localhost';
        
        // IMPORTANT: Change working directory to backend so paths resolve correctly
        const originalCwd = process.cwd();
        const backendPath = path.join(__dirname, 'backend');
        process.chdir(backendPath);
        
        // Require and start the backend server
        const serverPath = path.join(backendPath, 'server.js');
        const { startServer } = require(serverPath);
        
        backendServer = await startServer();
        console.log(`Backend server started on port ${serverPort}`);
        
        // Restore original working directory
        process.chdir(originalCwd);
        
        return true;
        
    } catch (error) {
        console.error('Failed to start backend server:', error);
        throw error;
    }
}

/**
 * Create the main application window
 */
function createWindow() {
    // Create the browser window
    mainWindow = new BrowserWindow({
        width: 1600,
        height: 900,
        minWidth: 1200,
        minHeight: 700,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: !isDev
        },
        icon: path.join(__dirname, 'build', 'icon.ico'),
        title: 'Experiment Analyzer - Schlatter',
        show: false // Don't show until ready
    });
    
    // Remove menu bar (optional - comment out if you want menu)
    mainWindow.setMenuBarVisibility(false);
    
    // Load the frontend
    const startUrl = `http://localhost:${serverPort}`;
    
    console.log(`Loading frontend from: ${startUrl}`);
    mainWindow.loadURL(startUrl);
    
    // Show window when ready
    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
        
        // Open DevTools in development
        if (isDev) {
            mainWindow.webContents.openDevTools();
        }
    });
    
    // Handle window closed
    mainWindow.on('closed', () => {
        mainWindow = null;
    });
    
    // Handle navigation to external URLs
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
    });
}

/**
 * Show error dialog and quit
 */
function showErrorAndQuit(title, message, details) {
    dialog.showErrorBox(title, `${message}\n\n${details}\n\nThe application will now exit.`);
    app.quit();
}

/**
 * Initialize the application
 */
async function initializeApp() {
    try {
        console.log('Initializing Experiment Analyzer...');
        console.log(`Running in ${isDev ? 'development' : 'production'} mode`);
        console.log(`App path: ${app.getAppPath()}`);
        console.log(`Executable path: ${app.getPath('exe')}`);
        
        // Step 1: Check R: drive access
        console.log('Checking R: drive access...');
        const rDriveCheck = checkRDriveAccess();
        
        if (!rDriveCheck.success) {
            showErrorAndQuit(
                'R: Drive Not Accessible',
                rDriveCheck.error,
                rDriveCheck.details + '\n\nPlease ensure the R: drive is mapped and accessible.'
            );
            return;
        }
        
        console.log('✓ R: drive accessible');
        
        // Step 2: Copy DLLs to app directory if needed (for native modules)
        copyRequiredDLLs();
        
        // Step 3: Start backend server
        console.log('Starting backend server...');
        await startBackendServer();
        
        // Step 4: Wait a moment for server to be fully ready
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Step 5: Create the main window
        console.log('Creating main window...');
        createWindow();
        
        console.log('✓ Application initialized successfully');
        
    } catch (error) {
        console.error('Failed to initialize application:', error);
        
        showErrorAndQuit(
            'Application Initialization Failed',
            'Failed to start the Experiment Analyzer',
            error.message
        );
    }
}

/**
 * Copy required DLLs to application directory
 */
function copyRequiredDLLs() {
    try {
        const appPath = isDev ? __dirname : path.dirname(app.getPath('exe'));
        const depsPath = isDev 
            ? path.join(__dirname, 'deps')
            : path.join(process.resourcesPath, 'deps');
        
        console.log(`App path: ${appPath}`);
        console.log(`Deps path: ${depsPath}`);
        
        if (!fs.existsSync(depsPath)) {
            console.warn('Dependencies folder not found, native modules may not work');
            return;
        }
        
        // Copy DLLs to app directory if in production
        if (!isDev) {
            const dllsToCopy = [
                'opencv_world4100.dll',
                'opencv_world4100d.dll',
                'hdf5.dll',
                'zlib.dll',
                'aec.dll'
            ];
            
            dllsToCopy.forEach(dll => {
                const sourcePath = path.join(depsPath, dll);
                const targetPath = path.join(appPath, dll);
                
                if (fs.existsSync(sourcePath) && !fs.existsSync(targetPath)) {
                    try {
                        fs.copyFileSync(sourcePath, targetPath);
                        console.log(`Copied ${dll} to app directory`);
                    } catch (error) {
                        console.warn(`Failed to copy ${dll}: ${error.message}`);
                    }
                }
            });
        }
        
    } catch (error) {
        console.error('Error copying DLLs:', error);
    }
}

// === APP EVENT HANDLERS ===

// This method will be called when Electron has finished initialization
app.whenReady().then(() => {
    initializeApp();
});

// Quit when all windows are closed
app.on('window-all-closed', () => {
    // Cleanup backend server
    if (backendServer) {
        console.log('Shutting down backend server...');
        backendServer.close(() => {
            console.log('Backend server stopped');
        });
    }
    
    // On Windows, quit the app
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// Handle app activation (macOS)
app.on('activate', () => {
    if (mainWindow === null) {
        createWindow();
    }
});

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    console.log('Another instance is already running, quitting...');
    app.quit();
} else {
    app.on('second-instance', () => {
        // Someone tried to run a second instance, focus our window instead
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });
}

// Handle certificate errors (for local development)
app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
    if (isDev && url.startsWith('https://localhost')) {
        // Ignore certificate errors in development
        event.preventDefault();
        callback(true);
    } else {
        // Use default behavior in production
        callback(false);
    }
});

// Log unhandled errors
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    
    if (app.isReady()) {
        dialog.showErrorBox(
            'Unexpected Error',
            `An unexpected error occurred:\n\n${error.message}\n\nThe application may not function correctly.`
        );
    }
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});