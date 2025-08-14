/**
 * Native Dependencies Preparation Script
 * Copies all required DLLs and native modules for Windows Electron build
 * Ensures all C++ dependencies are bundled with the executable
 */

const fs = require('fs');
const path = require('path');

console.log('🔧 Preparing native dependencies for Electron build...');
console.log('═'.repeat(60));

// Configuration
const DEPS_DIR = 'runtime-deps';
const NATIVE_DIR = 'backend/native';

// DLL Sources - Update these paths to match your system
const DLL_SOURCES = {
    // OpenCV DLLs (already in thermal build folder)
    'opencv_world4100.dll': 'backend/native/thermal/build/Release/opencv_world4100.dll',
    'opencv_world4100d.dll': 'backend/native/thermal/build/Release/opencv_world4100d.dll',
    
    // HDF5 and dependencies from vcpkg - UPDATE THESE PATHS IF DIFFERENT
    'hdf5.dll': 'C:/vcpkg/installed/x64-windows/bin/hdf5.dll',
    'hdf5_cpp.dll': 'C:/vcpkg/installed/x64-windows/bin/hdf5_cpp.dll',
    'zlib1.dll': 'C:/vcpkg/installed/x64-windows/bin/zlib1.dll',
    'aec.dll': 'C:/vcpkg/installed/x64-windows/bin/aec.dll',
    'szip.dll': 'C:/vcpkg/installed/x64-windows/bin/szip.dll',
    
    // Visual C++ Runtime (usually already on system, but include for safety)
    'msvcp140.dll': 'C:/Windows/System32/msvcp140.dll',
    'vcruntime140.dll': 'C:/Windows/System32/vcruntime140.dll',
    'vcruntime140_1.dll': 'C:/Windows/System32/vcruntime140_1.dll'
};

// Alternative vcpkg paths to try (in case vcpkg is installed elsewhere)
const ALTERNATIVE_VCPKG_PATHS = [
    'C:/vcpkg/installed/x64-windows/bin/',
    'C:/tools/vcpkg/installed/x64-windows/bin/',
    'D:/vcpkg/installed/x64-windows/bin/',
    'E:/vcpkg/installed/x64-windows/bin/'
];

// Native modules to verify
const NATIVE_MODULES = {
    'hdf5_native.node': 'backend/native/hdf5/build/Release/hdf5_native.node',
    'thermal_engine.node': 'backend/native/thermal/build/Release/thermal_engine.node'
};

// Required DLLs that must be present
const CRITICAL_DLLS = [
    'hdf5.dll',
    'zlib1.dll',
    'aec.dll',
    'opencv_world4100.dll'
];

/**
 * Find vcpkg DLL in alternative locations
 */
function findVcpkgDLL(dllName) {
    for (const basePath of ALTERNATIVE_VCPKG_PATHS) {
        const fullPath = path.join(basePath, dllName);
        if (fs.existsSync(fullPath)) {
            console.log(`📍 Found ${dllName} at: ${fullPath}`);
            return fullPath;
        }
    }
    return null;
}

/**
 * Check if file exists and copy it
 */
function copyIfExists(source, target, description, isCritical = false) {
    if (fs.existsSync(source)) {
        try {
            // Ensure target directory exists
            const targetDir = path.dirname(target);
            if (!fs.existsSync(targetDir)) {
                fs.mkdirSync(targetDir, { recursive: true });
            }
            
            fs.copyFileSync(source, target);
            const stats = fs.statSync(target);
            const sizeKB = Math.round(stats.size / 1024);
            console.log(`✅ ${description}: ${path.basename(target)} (${sizeKB} KB)`);
            return true;
        } catch (error) {
            console.error(`❌ Failed to copy ${description}: ${error.message}`);
            if (isCritical) {
                throw new Error(`Critical dependency failed: ${description}`);
            }
            return false;
        }
    } else {
        if (isCritical) {
            // Try to find in alternative locations for vcpkg DLLs
            if (source.includes('vcpkg')) {
                const dllName = path.basename(source);
                const alternativePath = findVcpkgDLL(dllName);
                if (alternativePath) {
                    return copyIfExists(alternativePath, target, description, isCritical);
                }
            }
            
            console.error(`❌ CRITICAL: Missing ${description}: ${source}`);
            throw new Error(`Critical dependency missing: ${source}`);
        } else {
            console.warn(`⚠️  Optional: Missing ${description}: ${source}`);
            return false;
        }
    }
}

/**
 * Verify native modules are built
 */
function verifyNativeModules() {
    console.log('\n📦 Verifying native modules...');
    
    let allPresent = true;
    
    for (const [moduleName, modulePath] of Object.entries(NATIVE_MODULES)) {
        if (fs.existsSync(modulePath)) {
            const stats = fs.statSync(modulePath);
            const sizeKB = Math.round(stats.size / 1024);
            console.log(`✅ Native module: ${moduleName} (${sizeKB} KB)`);
        } else {
            console.error(`❌ MISSING: Native module ${moduleName} at ${modulePath}`);
            allPresent = false;
        }
    }
    
    if (!allPresent) {
        console.error('\n💥 Native modules missing! Please run:');
        console.error('   cd backend/native/hdf5 && npm run build');
        console.error('   cd backend/native/thermal && npm run build');
        throw new Error('Native modules not built');
    }
    
    return true;
}

/**
 * Main preparation function
 */
function main() {
    try {
        console.log(`📁 Target directory: ${DEPS_DIR}`);
        console.log(`🏠 Working directory: ${process.cwd()}`);
        
        // Create runtime dependencies directory
        if (!fs.existsSync(DEPS_DIR)) {
            fs.mkdirSync(DEPS_DIR, { recursive: true });
            console.log(`📁 Created directory: ${DEPS_DIR}`);
        } else {
            console.log(`📁 Using existing directory: ${DEPS_DIR}`);
        }
        
        // Verify native modules first
        verifyNativeModules();
        
        // Copy DLL dependencies
        console.log('\n📚 Copying DLL dependencies...');
        let dllCount = 0;
        let criticalCount = 0;
        
        for (const [filename, sourcePath] of Object.entries(DLL_SOURCES)) {
            const targetPath = path.join(DEPS_DIR, filename);
            const isCritical = CRITICAL_DLLS.includes(filename);
            
            const success = copyIfExists(sourcePath, targetPath, `DLL ${filename}`, isCritical);
            if (success) {
                dllCount++;
                if (isCritical) criticalCount++;
            }
        }
        
        // Summary
        console.log('\n📊 Preparation Summary:');
        console.log('═'.repeat(40));
        console.log(`✅ Native modules verified: ${Object.keys(NATIVE_MODULES).length}`);
        console.log(`📚 DLLs copied: ${dllCount}/${Object.keys(DLL_SOURCES).length}`);
        console.log(`🎯 Critical DLLs: ${criticalCount}/${CRITICAL_DLLS.length}`);
        
        // Check critical dependencies
        const missingCritical = CRITICAL_DLLS.filter(dll => 
            !fs.existsSync(path.join(DEPS_DIR, dll))
        );
        
        if (missingCritical.length > 0) {
            console.error(`\n❌ Missing critical DLLs: ${missingCritical.join(', ')}`);
            console.error('\n🔧 Troubleshooting:');
            console.error('   1. Ensure vcpkg is installed with HDF5 package');
            console.error('   2. Check vcpkg path in this script');
            console.error('   3. Verify native modules are built');
            throw new Error('Critical dependencies missing');
        }
        
        // List all files in deps directory
        console.log('\n📋 Files prepared for bundling:');
        const files = fs.readdirSync(DEPS_DIR);
        files.forEach(file => {
            const filePath = path.join(DEPS_DIR, file);
            const stats = fs.statSync(filePath);
            const sizeKB = Math.round(stats.size / 1024);
            const isCritical = CRITICAL_DLLS.includes(file) ? '🎯' : '📄';
            console.log(`   ${isCritical} ${file} (${sizeKB} KB)`);
        });
        
        const totalSize = files.reduce((total, file) => {
            const stats = fs.statSync(path.join(DEPS_DIR, file));
            return total + stats.size;
        }, 0);
        
        console.log(`\n📦 Total dependency size: ${Math.round(totalSize / 1024 / 1024)} MB`);
        console.log('\n🎉 Native dependencies preparation complete!');
        console.log('✅ Ready for Electron build');
        
    } catch (error) {
        console.error('\n💥 Preparation failed:', error.message);
        console.error('\n🔧 Common solutions:');
        console.error('   • Install vcpkg with: vcpkg install hdf5[cpp]:x64-windows');
        console.error('   • Install OpenCV to C:/opencv/');
        console.error('   • Build native modules: npm run build-native');
        console.error('   • Update paths in prepare-deps.js if needed');
        process.exit(1);
    }
}

// Auto-detect vcpkg installation
function detectVcpkgPath() {
    console.log('\n🔍 Detecting vcpkg installation...');
    
    for (const basePath of ALTERNATIVE_VCPKG_PATHS) {
        if (fs.existsSync(basePath)) {
            console.log(`📍 Found vcpkg at: ${basePath}`);
            
            // Update DLL sources with detected path
            const vcpkgDlls = ['hdf5.dll', 'hdf5_cpp.dll', 'zlib1.dll', 'aec.dll', 'szip.dll'];
            vcpkgDlls.forEach(dll => {
                if (DLL_SOURCES[dll] && DLL_SOURCES[dll].includes('C:/vcpkg/')) {
                    DLL_SOURCES[dll] = path.join(basePath, dll);
                }
            });
            
            return basePath;
        }
    }
    
    console.warn('⚠️  vcpkg not found in standard locations');
    console.warn('   Please update DLL_SOURCES paths in this script');
    return null;
}

// Run preparation
if (require.main === module) {
    console.log('🚀 Starting native dependencies preparation...');
    detectVcpkgPath();
    main();
}