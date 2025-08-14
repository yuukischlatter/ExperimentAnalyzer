/**
 * Experiment Analyzer - Electron Preload Script
 * Safely exposes Electron APIs to the renderer process (frontend)
 * Provides secure bridge between main process and your web application
 */

const { contextBridge, ipcRenderer } = require('electron');

console.log('🔗 Electron preload script initializing...');

// Expose safe APIs to renderer process
contextBridge.exposeInMainWorld('electronAPI', {
    // App information
    getAppInfo: () => ipcRenderer.invoke('get-app-info'),
    
    // Window controls (for custom title bar if needed)
    minimizeWindow: () => ipcRenderer.invoke('window-minimize'),
    maximizeWindow: () => ipcRenderer.invoke('window-maximize'),
    closeWindow: () => ipcRenderer.invoke('window-close'),
    
    // R: drive verification
    verifyRDrive: () => ipcRenderer.invoke('verify-r-drive'),
    
    // File system access
    selectDirectory: () => ipcRenderer.invoke('select-directory'),
    
    // Listen for events from main process
    onDirectorySelected: (callback) => {
        const wrappedCallback = (event, path) => callback(path);
        ipcRenderer.on('directory-selected', wrappedCallback);
        
        // Return cleanup function
        return () => {
            ipcRenderer.removeListener('directory-selected', wrappedCallback);
        };
    },
    
    // Remove listeners (cleanup)
    removeAllListeners: (channel) => {
        ipcRenderer.removeAllListeners(channel);
    },
    
    // Platform info
    platform: process.platform,
    arch: process.arch,
    
    // Environment detection
    isElectron: true,
    isDevelopment: process.env.NODE_ENV === 'development',
    
    // Version information
    versions: {
        electron: process.versions.electron,
        node: process.versions.node,
        chrome: process.versions.chrome
    }
});

// Enhanced error handling and logging
window.addEventListener('DOMContentLoaded', () => {
    console.log('🔗 Electron preload script loaded successfully');
    
    // Add Electron-specific CSS class to body for styling
    document.body.classList.add('electron-app');
    
    // Add platform-specific class for platform-specific styling
    document.body.classList.add(`platform-${process.platform}`);
    
    // Add development mode class
    if (process.env.NODE_ENV === 'development') {
        document.body.classList.add('development-mode');
    }
    
    // Override console for better Electron debugging
    const originalConsole = { ...console };
    
    ['log', 'warn', 'error', 'info'].forEach(method => {
        console[method] = (...args) => {
            // Prefix with [Renderer] for main process logs
            originalConsole[method](`[Renderer]`, ...args);
        };
    });
    
    // Add Electron info to window for debugging
    if (process.env.NODE_ENV === 'development') {
        window.electronDebug = {
            platform: process.platform,
            arch: process.arch,
            versions: process.versions,
            pid: process.pid
        };
        console.log('🔧 Electron debug info available at window.electronDebug');
    }
    
    // Notify that Electron environment is ready
    console.log('✅ Electron renderer environment ready');
    console.log(`📱 Platform: ${process.platform} (${process.arch})`);
    console.log(`⚡ Electron: ${process.versions.electron}`);
    console.log(`🟢 Node: ${process.versions.node}`);
    console.log(`🌐 Chrome: ${process.versions.chrome}`);
});

// Global error handler for renderer process
window.addEventListener('error', (event) => {
    console.error('💥 Renderer process error:', {
        message: event.error.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        stack: event.error.stack
    });
    
    // In development, you might want to show more detailed errors
    if (process.env.NODE_ENV === 'development') {
        console.error('📍 Error details:', event.error);
    }
});

// Handle unhandled promise rejections
window.addEventListener('unhandledrejection', (event) => {
    console.error('🚫 Unhandled promise rejection in renderer:', {
        reason: event.reason,
        promise: event.promise
    });
    
    // In development, log more details
    if (process.env.NODE_ENV === 'development') {
        console.error('📍 Rejection details:', event.reason);
    }
});

// Enhanced keyboard shortcuts for development
if (process.env.NODE_ENV === 'development') {
    window.addEventListener('keydown', (event) => {
        // Ctrl+Shift+I or F12: Toggle DevTools (handled by Electron)
        if ((event.ctrlKey && event.shiftKey && event.key === 'I') || event.key === 'F12') {
            console.log('🔧 DevTools toggle requested');
        }
        
        // Ctrl+R or F5: Reload (handled by Electron)
        if ((event.ctrlKey && event.key === 'r') || event.key === 'F5') {
            console.log('🔄 Reload requested');
        }
        
        // Ctrl+Shift+R: Hard reload (handled by Electron)
        if (event.ctrlKey && event.shiftKey && event.key === 'R') {
            console.log('🔄 Hard reload requested');
        }
    });
}

// Security: Disable node integration in renderer
if (window.require) {
    delete window.require;
}
if (window.exports) {
    delete window.exports;
}
if (window.module) {
    delete window.module;
}

// Security: Override eval to prevent code injection
window.eval = function() {
    throw new Error('eval() is disabled for security reasons');
};

// Performance monitoring (development only)
if (process.env.NODE_ENV === 'development') {
    // Log performance metrics
    window.addEventListener('load', () => {
        setTimeout(() => {
            const perfData = performance.getEntriesByType('navigation')[0];
            if (perfData) {
                console.log('📊 Page load performance:', {
                    domContentLoaded: Math.round(perfData.domContentLoadedEventEnd - perfData.domContentLoadedEventStart),
                    loadComplete: Math.round(perfData.loadEventEnd - perfData.loadEventStart),
                    totalTime: Math.round(perfData.loadEventEnd - perfData.fetchStart)
                });
            }
        }, 100);
    });
    
    // Memory usage monitoring
    if (performance.memory) {
        setInterval(() => {
            const memory = performance.memory;
            if (memory.usedJSHeapSize > 50 * 1024 * 1024) { // 50MB threshold
                console.warn('⚠️ High memory usage detected:', {
                    used: Math.round(memory.usedJSHeapSize / 1024 / 1024) + 'MB',
                    total: Math.round(memory.totalJSHeapSize / 1024 / 1024) + 'MB',
                    limit: Math.round(memory.jsHeapSizeLimit / 1024 / 1024) + 'MB'
                });
            }
        }, 30000); // Check every 30 seconds
    }
}

// Database status indicator helper
window.electronHelpers = {
    // Check R: drive status and update UI
    checkDatabaseStatus: async () => {
        try {
            const isAccessible = await window.electronAPI.verifyRDrive();
            return {
                accessible: isAccessible,
                message: isAccessible ? 'R: drive accessible' : 'R: drive not accessible'
            };
        } catch (error) {
            console.error('Error checking R: drive status:', error);
            return {
                accessible: false,
                message: 'Error checking R: drive status'
            };
        }
    },
    
    // Get app information
    getSystemInfo: async () => {
        try {
            const appInfo = await window.electronAPI.getAppInfo();
            return {
                ...appInfo,
                rendererPid: process.pid,
                platform: process.platform,
                arch: process.arch
            };
        } catch (error) {
            console.error('Error getting system info:', error);
            return null;
        }
    }
};

// Expose version info to your application
window.electronVersion = {
    app: '1.0.0', // Your app version
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
    platform: process.platform,
    arch: process.arch
};

console.log('🚀 Electron preload script initialization complete');