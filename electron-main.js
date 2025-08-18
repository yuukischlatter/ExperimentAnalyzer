/**
 * Electron Main Process
 * Entry point for the Electron application
 * UPDATED: Support for UNC paths for portable exe
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

// UNC path configuration (matches backend config)
const UNC_BASE = '\\\\NAS\\projekt_1405';
const UNC_SCHWEISSUNGEN = `${UNC_BASE}\\Schweissungen`;

/**
 * Check if network path is accessible (UNC or drive letter)
 */
function checkNetworkAccess() {
    // Try UNC path first
    const uncPath = UNC_SCHWEISSUNGEN;
    
    try {
        console.log(`Checking UNC path: ${uncPath}`);
        
        // Check if UNC path exists
        if (fs.existsSync(uncPath)) {
            console.log(`✅ UNC path accessible: ${uncPath}`);
            
            // Test read access
            try {
                fs.readdirSync(uncPath);
                return {
                    success: true,
                    path: uncPath,
                    type: 'UNC'
                };
            } catch (readError) {
                return {
                    success: false,
                    error: 'UNC path exists but cannot read',
                    details: readError.message
                };
            }
        }
        
        // If UNC fails, try R: drive as fallback
        const rDrivePath = 'R:\\Schweissungen';
        console.log(`UNC not accessible, trying R: drive: ${rDrivePath}`);
        
        if (fs.existsSync(rDrivePath)) {
            console.log(`✅ R: drive accessible: ${rDrivePath}`);
            
            // Test read access
            try {
                fs.readdirSync(rDrivePath);
                return {
                    success: true,
                    path: rDrivePath,
                    type: 'Drive Letter'
                };
            } catch (readError) {
                return {
                    success: false,
                    error: 'R: drive exists but cannot read',
                    details: readError.message
                };
            }
        }
        
        // Neither path works
        return {
            success: false,
            error: 'Network path not accessible',
            details: `Cannot access either:\n- UNC: ${uncPath}\n- Drive: ${rDrivePath}`
        };
        
    } catch (error) {
        return {
            success: false,
            error: 'Network access check failed',
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
        
        // Determine the correct backend path
        let backendPath;
        if (isDev) {
            // Development: backend is in project root
            backendPath = path.join(__dirname, 'backend');
        } else {
            // Production: backend is relative to resources/app
            backendPath = path.join(process.resourcesPath, 'app', 'backend');
            
            // If app.asar is not used, try direct path
            if (!fs.existsSync(backendPath)) {
                backendPath = path.join(path.dirname(app.getPath('exe')), 'backend');
            }
        }
        
        console.log(`Backend path: ${backendPath}`);
        
        // Verify backend exists
        if (!fs.existsSync(backendPath)) {
            throw new Error(`Backend not found at: ${backendPath}`);
        }
        
        // Change working directory to backend
        const originalCwd = process.cwd();
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
 * Show error dialog with retry option
 */
async function showErrorWithRetry(title, message, details) {
    const result = await dialog.showMessageBox(null, {
        type: 'error',
        title: title,
        message: message,
        detail: details,
        buttons: ['Retry', 'Quit'],
        defaultId: 0,
        cancelId: 1
    });
    
    return result.response === 0; // true if Retry was clicked
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
        
        // Step 1: Check network access with retry capability
        let networkCheck;
        let retryCount = 0;
        const maxRetries = 3;
        
        while (retryCount < maxRetries) {
            console.log(`Checking network access (attempt ${retryCount + 1}/${maxRetries})...`);
            networkCheck = checkNetworkAccess();
            
            if (networkCheck.success) {
                break;
            }
            
            if (retryCount < maxRetries - 1) {
                // Show retry dialog
                const shouldRetry = await showErrorWithRetry(
                    'Network Path Not Accessible',
                    networkCheck.error,
                    `${networkCheck.details}\n\nAttempt ${retryCount + 1} of ${maxRetries}\n\n` +
                    'Please ensure:\n' +
                    '• You are connected to the network\n' +
                    '• VPN is connected (if required)\n' +
                    `• Network path ${UNC_BASE} is accessible\n` +
                    '• Or R: drive is mapped'
                );
                
                if (!shouldRetry) {
                    app.quit();
                    return;
                }
                
                // Wait a bit before retrying
                await new Promise(resolve => setTimeout(resolve, 2000));
                retryCount++;
            } else {
                // Final attempt failed
                showErrorAndQuit(
                    'Network Path Not Accessible',
                    networkCheck.error,
                    `${networkCheck.details}\n\n` +
                    'The application requires access to the network path.\n\n' +
                    'Please ensure:\n' +
                    '• You are connected to the company network\n' +
                    '• VPN is connected (if working remotely)\n' +
                    `• You have access to ${UNC_BASE}\n` +
                    '• Or map the network drive to R:\\'
                );
                return;
            }
        }
        
        console.log(`✓ Network accessible via ${networkCheck.type}: ${networkCheck.path}`);
        
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
                'aec.dll',
                'szip.dll',
                'zlib1.dll'
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