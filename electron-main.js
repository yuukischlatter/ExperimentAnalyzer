/**
 * Experiment Analyzer - Electron Main Process
 * Manages the desktop application window and runs backend server embedded
 * Database: R:\Schweissungen\experiments.db (shared network location)
 * SIMPLIFIED: No asar - uses standard file system layout
 */

const { app, BrowserWindow, Menu, dialog, shell, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const isDev = require('electron-is-dev');

let mainWindow = null;
let backendServer = null;
const serverPort = 5001; // Different port for Electron to avoid conflicts

// Application configuration
const APP_CONFIG = {
    name: 'Experiment Analyzer',
    version: require('./package.json').version,
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 700
};

/**
 * Setup R: drive database configuration
 */
function setupDatabaseConfig() {
    // Force R: drive database location for Electron
    process.env.DB_PATH = 'R:\\Schweissungen\\experiments.db';
    process.env.EXPERIMENT_ROOT_PATH = 'R:\\Schweissungen';
    
    // Override port for Electron
    process.env.PORT = serverPort;
    process.env.HOST = 'localhost';
    process.env.NODE_ENV = isDev ? 'development' : 'production';
    process.env.ELECTRON = 'true';
    
    console.log(`📁 Database configured: R:\\Schweissungen\\experiments.db`);
    console.log(`📂 Experiment root: R:\\Schweissungen`);
}

/**
 * Verify R: drive accessibility
 */
function verifyRDrive() {
    try {
        const rDrivePath = 'R:\\';
        const schweissungenPath = 'R:\\Schweissungen';
        
        // Check if R: drive exists
        if (!fs.existsSync(rDrivePath)) {
            throw new Error('R: drive is not accessible');
        }
        
        // Check if Schweissungen directory exists, create if needed
        if (!fs.existsSync(schweissungenPath)) {
            console.log('📁 Creating Schweissungen directory...');
            fs.mkdirSync(schweissungenPath, { recursive: true });
        }
        
        // Test write access
        const testFile = path.join(schweissungenPath, '.write_test');
        fs.writeFileSync(testFile, 'test');
        fs.unlinkSync(testFile);
        
        console.log('✅ R: drive accessible and writable');
        return true;
        
    } catch (error) {
        console.error('❌ R: drive verification failed:', error.message);
        
        // Show error dialog and exit
        dialog.showErrorBox(
            'R: Drive Error',
            `Cannot access R: drive for database storage.\n\n` +
            `Error: ${error.message}\n\n` +
            `Please ensure:\n` +
            `• R: drive is mapped and accessible\n` +
            `• You have read/write permissions\n` +
            `• Network connection is stable\n\n` +
            `Application will now exit.`
        );
        
        app.quit();
        return false;
    }
}

/**
 * Start the backend server embedded in main process
 */
async function startBackendServer() {
    try {
        console.log('🚀 Starting embedded backend server...');
        
        // Setup database and environment configuration
        setupDatabaseConfig();
        
        // Verify R: drive before starting server
        if (!verifyRDrive()) {
            return; // Error dialog already shown, app will quit
        }
        
        // Determine backend path (simplified for no-asar)
        let backendPath;
        if (isDev) {
            backendPath = path.join(__dirname, 'backend');
        } else {
            // In production without asar, backend is just in the app directory
            backendPath = path.join(__dirname, 'backend');
        }
        
        console.log(`📁 Backend path: ${backendPath}`);
        
        // Verify backend path exists
        if (!fs.existsSync(backendPath)) {
            throw new Error(`Backend path not found: ${backendPath}`);
        }
        
        // EARLY: Change working directory BEFORE any requires
        const originalCwd = process.cwd();
        console.log(`📁 Changing working directory to: ${backendPath}`);
        process.chdir(backendPath);
        
        // Import and start the backend server (now from correct working directory)
        console.log('📦 Importing backend server...');
        const serverPath = path.join(backendPath, 'server.js');
        console.log(`📍 Server path: ${serverPath}`);
        
        // Verify server file exists
        if (!fs.existsSync(serverPath)) {
            throw new Error(`Backend server file not found: ${serverPath}`);
        }
        
        const { startServer } = require(serverPath);
        
        console.log('🔄 Starting backend server...');
        backendServer = await startServer();
        
        // DON'T restore working directory - keep it as backend directory
        // process.chdir(originalCwd); // Commented out to keep backend as working dir
        
        console.log(`✅ Backend server running on port ${serverPort}`);
        
    } catch (error) {
        console.error('❌ Failed to start backend server:', error);
        
        // Show error dialog
        dialog.showErrorBox(
            'Server Error', 
            `Failed to start the backend server:\n\n${error.message}\n\n` +
            `Please check:\n` +
            `• R: drive is accessible\n` +
            `• Port ${serverPort} is not in use\n` +
            `• All dependencies are available\n\n` +
            `Technical details:\n${error.stack || 'No stack trace available'}`
        );
        
        app.quit();
    }
}

/**
 * Create the main application window
 */
function createMainWindow() {
    console.log('🖥️  Creating main window...');
    
    // Create browser window
    mainWindow = new BrowserWindow({
        width: APP_CONFIG.width,
        height: APP_CONFIG.height,
        minWidth: APP_CONFIG.minWidth,
        minHeight: APP_CONFIG.minHeight,
        
        // Window styling
        title: APP_CONFIG.name,
        icon: getAppIcon(),
        show: false, // Don't show until ready
        
        // Web preferences
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            enableRemoteModule: false,
            preload: path.join(__dirname, 'electron-preload.js'),
            webSecurity: !isDev, // Disable in dev for local file access
            allowRunningInsecureContent: false
        },
        
        // Platform specific
        titleBarStyle: 'default',
        frame: true,
        backgroundColor: '#f5f5f5'
    });

    // Load the application from backend server
    const appUrl = `http://localhost:${serverPort}`;
    console.log(`🌐 Loading app from: ${appUrl}`);
    
    mainWindow.loadURL(appUrl);

    // Open DevTools in development
    if (isDev) {
        mainWindow.webContents.openDevTools();
        console.log('🔧 Development mode - DevTools opened');
    }

    // Window event handlers
    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
        console.log(`🎉 ${APP_CONFIG.name} ready!`);
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
        console.log('🪟 Main window closed');
    });

    // Handle external links
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
    });

    // Prevent navigation away from the app
    mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
        const parsedUrl = new URL(navigationUrl);
        
        if (parsedUrl.origin !== `http://localhost:${serverPort}`) {
            event.preventDefault();
            console.log(`🚫 Blocked navigation to: ${navigationUrl}`);
        }
    });

    return mainWindow;
}

/**
 * Get platform-specific app icon
 */
function getAppIcon() {
    const iconPath = path.join(__dirname, 'build', 'icon.ico');
    return fs.existsSync(iconPath) ? iconPath : undefined;
}

/**
 * Create application menu
 */
function createMenu() {
    const template = [
        {
            label: 'File',
            submenu: [
                {
                    label: 'Open Experiment Directory',
                    accelerator: 'CmdOrCtrl+O',
                    click: () => {
                        dialog.showOpenDialog(mainWindow, {
                            properties: ['openDirectory'],
                            title: 'Select Experiment Directory',
                            defaultPath: 'R:\\Schweissungen'
                        }).then(result => {
                            if (!result.canceled && result.filePaths.length > 0) {
                                // Send to renderer process
                                mainWindow.webContents.send('directory-selected', result.filePaths[0]);
                            }
                        });
                    }
                },
                { type: 'separator' },
                {
                    label: 'Exit',
                    accelerator: 'Alt+F4',
                    click: () => {
                        app.quit();
                    }
                }
            ]
        },
        {
            label: 'View',
            submenu: [
                { role: 'reload' },
                { role: 'forceReload' },
                { role: 'toggleDevTools' },
                { type: 'separator' },
                { role: 'resetZoom' },
                { role: 'zoomIn' },
                { role: 'zoomOut' },
                { type: 'separator' },
                { role: 'togglefullscreen' }
            ]
        },
        {
            label: 'Database',
            submenu: [
                {
                    label: 'Check R: Drive Status',
                    click: () => {
                        const accessible = verifyRDrive();
                        if (accessible) {
                            dialog.showMessageBox(mainWindow, {
                                type: 'info',
                                title: 'R: Drive Status',
                                message: 'R: Drive Accessible',
                                detail: 'Database location: R:\\Schweissungen\\experiments.db\nStatus: Connected and writable'
                            });
                        }
                    }
                },
                {
                    label: 'Open Database Directory',
                    click: () => {
                        shell.openPath('R:\\Schweissungen');
                    }
                }
            ]
        },
        {
            label: 'Help',
            submenu: [
                {
                    label: 'About',
                    click: () => {
                        dialog.showMessageBox(mainWindow, {
                            type: 'info',
                            title: 'About Experiment Analyzer',
                            message: `${APP_CONFIG.name} v${APP_CONFIG.version}`,
                            detail: `Schlatter Industries AG\nWelding Data Analysis System\n\nDatabase: R:\\Schweissungen\\experiments.db\nServer: localhost:${serverPort}\nMode: ${isDev ? 'Development' : 'Production'}`
                        });
                    }
                },
                {
                    label: 'System Info',
                    click: () => {
                        dialog.showMessageBox(mainWindow, {
                            type: 'info',
                            title: 'System Information',
                            message: 'System Information',
                            detail: `Platform: ${process.platform}\nArch: ${process.arch}\nElectron: ${process.versions.electron}\nNode: ${process.versions.node}\nChrome: ${process.versions.chrome}\nApp Path: ${app.getAppPath()}`
                        });
                    }
                }
            ]
        }
    ];

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
}

/**
 * Handle IPC messages from renderer process
 */
function setupIPC() {
    // Handle requests for app info
    ipcMain.handle('get-app-info', () => {
        return {
            name: APP_CONFIG.name,
            version: APP_CONFIG.version,
            platform: process.platform,
            isDev: isDev,
            serverPort: serverPort,
            databasePath: 'R:\\Schweissungen\\experiments.db',
            experimentRoot: 'R:\\Schweissungen',
            appPath: app.getAppPath()
        };
    });

    // Handle window control requests
    ipcMain.handle('window-minimize', () => {
        if (mainWindow) {
            mainWindow.minimize();
        }
    });

    ipcMain.handle('window-maximize', () => {
        if (mainWindow) {
            if (mainWindow.isMaximized()) {
                mainWindow.unmaximize();
            } else {
                mainWindow.maximize();
            }
        }
    });

    ipcMain.handle('window-close', () => {
        if (mainWindow) {
            mainWindow.close();
        }
    });

    // Handle R: drive verification requests
    ipcMain.handle('verify-r-drive', () => {
        return verifyRDrive();
    });
}

/**
 * App event handlers
 */
app.whenReady().then(async () => {
    console.log(`🖥️  Starting ${APP_CONFIG.name} v${APP_CONFIG.version}`);
    console.log(`🔧 Mode: ${isDev ? 'Development' : 'Production'}`);
    console.log(`📁 App path: ${app.getAppPath()}`);
    
    try {
        // Start backend server first
        await startBackendServer();
        
        // Create main window
        createMainWindow();
        
        // Create application menu
        createMenu();
        
        // Setup IPC handlers
        setupIPC();
        
        console.log('🎉 Application initialization complete!');
        
    } catch (error) {
        console.error('💥 Application startup failed:', error);
        app.quit();
    }
});

app.on('window-all-closed', () => {
    console.log('🛑 All windows closed');
    app.quit();
});

app.on('activate', () => {
    // On macOS, re-create window when dock icon is clicked
    if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
    }
});

app.on('before-quit', (event) => {
    console.log('🛑 Application shutting down...');
    
    // Clean up backend server if needed
    if (backendServer) {
        // Your backend server should handle graceful shutdown
    }
});

// Security: Prevent new window creation
app.on('web-contents-created', (event, contents) => {
    contents.on('new-window', (event, navigationUrl) => {
        event.preventDefault();
        shell.openExternal(navigationUrl);
    });
});

// Handle certificate errors (for development)
app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
    if (isDev && url.startsWith('http://localhost')) {
        // In development, ignore certificate errors for localhost
        event.preventDefault();
        callback(true);
        return;
    }
    
    // In production, use default behavior
    callback(false);
});

// Export for testing
module.exports = { createMainWindow, startBackendServer };