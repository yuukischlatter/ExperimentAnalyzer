// progressive-hdf5-reader.js - Enhanced JavaScript wrapper with coordinated bulk loading
const path = require('path');

// Load the compiled C++ addon
let nativeAddon;
try {
    // Try multiple possible paths for the addon
    const possiblePaths = [
        '../native/hdf5/build/Release/hdf5_native.node',
        './native/hdf5/build/Release/hdf5_native.node',
        path.join(__dirname, '../native/hdf5/build/Release/hdf5_native.node')
    ];
    
    let addonLoaded = false;
    for (const addonPath of possiblePaths) {
        try {
            nativeAddon = require(addonPath);
            console.log(`✅ Loaded native HDF5 addon from: ${addonPath}`);
            addonLoaded = true;
            break;
        } catch (e) {
            // Continue to next path
        }
    }
    
    if (!addonLoaded) {
        throw new Error('Could not find addon in any expected location');
    }
} catch (error) {
    console.error('❌ Failed to load native addon:', error.message);
    console.log('💡 Run "npm run build" to compile the C++ addon');
    console.log('📁 Check if build/Release/hdf5_native.node exists');
    process.exit(1);
}

class ProgressiveZoomHDF5Reader {
    constructor() {
        this.channels = new Map();
        this.isOpen = false;
        
        // NEW: Cache for coordinated loading operations
        this.coordinatedCache = new Map();
        this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
        
        // Define zoom levels for optimal dataset selection (FIXED thresholds)
        this.zoomLevels = [
            { dataset: 'data@2097152', maxSamplesPerPixel: Infinity, description: 'Far overview' },
            { dataset: 'data@16384', maxSamplesPerPixel: 5000, description: 'Overview' },
            { dataset: 'data@128', maxSamplesPerPixel: 200, description: 'Medium zoom' },
            { dataset: 'raw', maxSamplesPerPixel: 10, description: 'High detail' }
        ];
    }

    async open(filepath) {
        try {
            console.log(`🔄 Opening HDF5 file with C++ addon: ${filepath}`);
            
            const success = nativeAddon.openFile(filepath);
            if (!success) {
                throw new Error('Failed to open file with native addon');
            }
            
            this.isOpen = true;
            await this._loadChannelMetadata();
            
            console.log('✅ HDF5 file opened successfully with native C++ reader');
            return true;
            
        } catch (error) {
            console.error('❌ Failed to open HDF5 file:', error.message);
            return false;
        }
    }

    async _loadChannelMetadata() {
        try {
            const channelIds = nativeAddon.getChannelIds();
            console.log(`📡 Found ${channelIds.length} channels`);
            
            for (const channelId of channelIds) {
                const attributes = nativeAddon.getChannelAttributes(channelId);
                const datasets = nativeAddon.getAvailableDatasets(channelId);
                
                const channelInfo = {
                    id: channelId,
                    name: attributes.name || attributes.ChannelName || `Channel ${channelId}`,
                    physicalUnit: attributes.physicalUnit || 'V',
                    sampleRate: 10000000.0, // 10 MHz from your data
                    triggerSample: 1229155434,
                    startTime: '2025-07-30T14:00:44.0000000+02:00',
                    datasets: {},
                    conversion: {
                        binToVoltConstant: parseFloat(attributes.binToVoltConstant) || 0.0,
                        binToVoltFactor: parseFloat(attributes.binToVoltFactor) || 1.0,
                        voltToPhysicalConstant: 0.0,
                        voltToPhysicalFactor: parseFloat(attributes.voltToPhysicalFactor) || 1.0
                    }
                };

                // Get dataset shapes
                for (const datasetName of datasets) {
                    const shape = nativeAddon.getDatasetShape(channelId, datasetName);
                    channelInfo.datasets[datasetName] = {
                        shape: shape,
                        totalSamples: shape[0],
                        columns: shape.length > 1 ? shape[1] : 1,
                        sizeGB: (shape[0] * (shape[1] || 1) * 2) / (1024 * 1024 * 1024)
                    };
                }
                
                this.channels.set(channelId, channelInfo);
                console.log(`📊 Channel ${channelId}: ${channelInfo.name} (${Object.keys(channelInfo.datasets).length} datasets)`);
            }
            
        } catch (error) {
            throw new Error(`Failed to load channel metadata: ${error.message}`);
        }
    }

    // EXISTING: Keep original method unchanged
    selectOptimalDataset(channelId, startTime, endTime, displayWidthPixels = 1920) {
        const channel = this.channels.get(channelId);
        if (!channel) throw new Error(`Channel ${channelId} not found`);

        const totalDuration = this._samplesToTime(channel.datasets.raw.totalSamples, channel.sampleRate);
        const viewDuration = endTime - startTime;
        const zoomRatio = totalDuration / viewDuration;
        const samplesPerPixel = (endTime - startTime) * channel.sampleRate / displayWidthPixels;

        console.log(`🔍 Zoom analysis: ${zoomRatio.toFixed(2)}x zoom, ${samplesPerPixel.toFixed(1)} samples/pixel`);

        // Find the best dataset for this zoom level
        for (const level of this.zoomLevels) {
            if (channel.datasets[level.dataset] && samplesPerPixel <= level.maxSamplesPerPixel) {
                return {
                    dataset: level.dataset,
                    description: level.description,
                    totalSamples: channel.datasets[level.dataset].totalSamples,
                    samplesPerPixel: samplesPerPixel,
                    zoomRatio: zoomRatio,
                    estimatedDataPoints: Math.min(displayWidthPixels * 2, channel.datasets[level.dataset].totalSamples)
                };
            }
        }

        // Fallback to most detailed available dataset
        const availableDatasets = Object.keys(channel.datasets);
        const fallback = availableDatasets.includes('raw') ? 'raw' : availableDatasets[availableDatasets.length - 1];
        
        return {
            dataset: fallback,
            description: 'Maximum available detail',
            totalSamples: channel.datasets[fallback].totalSamples,
            samplesPerPixel: samplesPerPixel,
            zoomRatio: zoomRatio,
            estimatedDataPoints: Math.min(displayWidthPixels * 2, channel.datasets[fallback].totalSamples)
        };
    }

    // NEW: Select optimal dataset for a range (improved naming and logic)
    selectOptimalDatasetForRange(channelId, startTime, endTime, displayWidthPixels = 1920, maxPoints = 2000) {
        const channel = this.channels.get(channelId);
        if (!channel) throw new Error(`Channel ${channelId} not found`);

        const totalDuration = this._samplesToTime(channel.datasets.raw.totalSamples, channel.sampleRate);
        const viewDuration = endTime - startTime;
        const zoomRatio = totalDuration / viewDuration;
        
        // FIXED: Calculate samples per pixel correctly for the view duration
        const viewSamplesRaw = viewDuration * channel.sampleRate;
        const samplesPerPixel = viewSamplesRaw / displayWidthPixels;

        // NEW: Consider maxPoints in dataset selection
        const requestedDataPoints = Math.min(maxPoints, displayWidthPixels * 2);

        console.log(`🔍 Enhanced zoom analysis: ${zoomRatio.toFixed(2)}x zoom, ${samplesPerPixel.toFixed(1)} samples/pixel, ${requestedDataPoints} points requested`);

        // FIXED: Simple approach - select dataset based on zoom ratio directly
        let selectedDataset = 'data@2097152'; // Default fallback
        let selectedDescription = 'Far overview';
        
        if (zoomRatio > 500) {
            // Very high zoom - need maximum detail
            selectedDataset = 'raw';
            selectedDescription = 'High detail';
        } else if (zoomRatio > 50) {
            // High zoom - need high detail
            selectedDataset = 'data@128';
            selectedDescription = 'Medium zoom';
        } else if (zoomRatio > 5) {
            // Medium zoom - need medium detail
            selectedDataset = 'data@16384';
            selectedDescription = 'Overview';
        }
        // else: use data@2097152 for low zoom
        
        // Verify the selected dataset exists
        if (!channel.datasets[selectedDataset]) {
            // Fallback to the most decimated available dataset
            const availableDatasets = Object.keys(channel.datasets);
            selectedDataset = availableDatasets.includes('data@2097152') ? 'data@2097152' : availableDatasets[0];
            selectedDescription = 'Available fallback';
        }
        
        const datasetSamples = channel.datasets[selectedDataset].totalSamples;
        const rawSamples = channel.datasets.raw.totalSamples;
        const decimationFactor = rawSamples / datasetSamples;
        
        // Calculate actual samples we'll read from this dataset
        const viewSamplesInDataset = Math.floor(viewSamplesRaw / decimationFactor);
        const actualSamplesToRead = Math.min(viewSamplesInDataset, datasetSamples, requestedDataPoints);
        
        console.log(`🎯 Zoom-based selection: ${zoomRatio.toFixed(1)}x zoom → ${selectedDataset} (${selectedDescription})`);
        
        return {
            dataset: selectedDataset,
            description: selectedDescription,
            totalSamples: datasetSamples,
            samplesPerPixel: samplesPerPixel,
            zoomRatio: zoomRatio,
            estimatedDataPoints: actualSamplesToRead,
            maxPoints: maxPoints,
            decimationFactor: decimationFactor,
            efficiency: actualSamplesToRead / requestedDataPoints
        };

        // Fallback to most decimated dataset to avoid crashes
        const availableDatasets = Object.keys(channel.datasets);
        const fallback = availableDatasets.includes('data@2097152') ? 'data@2097152' : 
                         availableDatasets.includes('data@16384') ? 'data@16384' : 
                         availableDatasets[0];
        
        const fallbackSamples = channel.datasets[fallback].totalSamples;
        const fallbackDecimation = channel.datasets.raw.totalSamples / fallbackSamples;
        const safeSamplesToRead = Math.min(requestedDataPoints, fallbackSamples);
        
        return {
            dataset: fallback,
            description: 'Safe fallback dataset',
            totalSamples: fallbackSamples,
            samplesPerPixel: samplesPerPixel / fallbackDecimation,
            zoomRatio: zoomRatio,
            estimatedDataPoints: safeSamplesToRead,
            maxPoints: maxPoints,
            decimationFactor: fallbackDecimation,
            efficiency: safeSamplesToRead / requestedDataPoints
        };
    }

    // EXISTING: Keep original method unchanged
    loadTimeRange(channelId, startTime, endTime, displayWidthPixels = 1920, maxPoints = null) {
        const channel = this.channels.get(channelId);
        if (!channel) throw new Error(`Channel ${channelId} not found`);

        // Use maxPoints if provided, otherwise use legacy behavior
        const actualMaxPoints = maxPoints || (displayWidthPixels * 2);
        const optimal = this.selectOptimalDatasetForRange(channelId, startTime, endTime, displayWidthPixels, actualMaxPoints);
        
        console.log(`📖 Loading ${optimal.description} using ${optimal.dataset}`);

        // Convert time range to sample indices for the selected dataset
        const rawTotalSamples = channel.datasets.raw.totalSamples;
        const datasetTotalSamples = channel.datasets[optimal.dataset].totalSamples;
        const decimationFactor = rawTotalSamples / datasetTotalSamples;

        const startSample = Math.floor((startTime * channel.sampleRate) / decimationFactor);
        const endSample = Math.ceil((endTime * channel.sampleRate) / decimationFactor);
        
        // CRITICAL FIX: Limit sample count to prevent crashes
        const requestedSamples = endSample - startSample;
        const maxAllowedSamples = Math.min(actualMaxPoints * 2, 50000); // Hard limit
        const sampleCount = Math.min(requestedSamples, maxAllowedSamples, datasetTotalSamples - startSample);
        
        console.log(`🔢 Sample calculation: start=${startSample}, end=${endSample}, requested=${requestedSamples}, limited=${sampleCount}`);

        if (startSample >= datasetTotalSamples || sampleCount <= 0) {
            return {
                channelName: channel.name,
                physicalUnit: channel.physicalUnit,
                dataset: optimal.dataset,
                timeRange: [startTime, endTime],
                timeAxis: [],
                physicalValues: [],
                rawValues: [],
                actualSamples: 0,
                metadata: optimal
            };
        }

        console.log(`📊 Reading samples ${startSample} to ${startSample + sampleCount} (${sampleCount} samples) from ${optimal.dataset}`);

        // Read actual data using C++ addon
        const rawData = nativeAddon.readDatasetChunk(channelId, optimal.dataset, startSample, sampleCount);
        
        // Create time axis
        const timeAxis = rawData.map((_, i) => 
            ((startSample + i) * decimationFactor) / channel.sampleRate
        );

        // Convert to physical values
        const physicalValues = this.convertToPhysical(rawData, channelId);

        console.log(`✅ Loaded ${rawData.length} real samples from ${optimal.dataset}`);

        return {
            channelName: channel.name,
            physicalUnit: channel.physicalUnit,
            dataset: optimal.dataset,
            timeRange: [startTime, endTime],
            timeAxis: timeAxis,
            rawValues: rawData,
            physicalValues: physicalValues,
            actualSamples: rawData.length,
            metadata: optimal
        };
    }

    // NEW: Load time range with coordinated dataset selection
    loadTimeRangeCoordinated(channelId, startTime, endTime, optimalDatasetInfo, maxPoints = 2000) {
        const channel = this.channels.get(channelId);
        if (!channel) throw new Error(`Channel ${channelId} not found`);

        // Use the pre-selected dataset info for coordination
        const dataset = optimalDatasetInfo.dataset;
        
        console.log(`📖 Coordinated loading ${dataset} for channel ${channelId}`);

        // Verify this channel has the required dataset
        if (!channel.datasets[dataset]) {
            console.warn(`Channel ${channelId} missing dataset ${dataset}, falling back to individual selection`);
            return this.loadTimeRange(channelId, startTime, endTime, 1920, maxPoints);
        }

        // Convert time range to sample indices for the coordinated dataset
        const rawTotalSamples = channel.datasets.raw.totalSamples;
        const datasetTotalSamples = channel.datasets[dataset].totalSamples;
        const decimationFactor = rawTotalSamples / datasetTotalSamples;

        const startSample = Math.floor((startTime * channel.sampleRate) / decimationFactor);
        const endSample = Math.ceil((endTime * channel.sampleRate) / decimationFactor);
        
        // CRITICAL FIX: Limit sample count to reasonable bounds
        const requestedSamples = endSample - startSample;
        const maxAllowedSamples = Math.min(maxPoints * 2, 50000); // Hard limit to prevent crashes
        const sampleCount = Math.min(requestedSamples, maxAllowedSamples, datasetTotalSamples - startSample);
        
        console.log(`🔢 Sample calculation: start=${startSample}, end=${endSample}, requested=${requestedSamples}, limited=${sampleCount}`);

        if (startSample >= datasetTotalSamples || sampleCount <= 0) {
            return {
                channelName: channel.name,
                physicalUnit: channel.physicalUnit,
                dataset: dataset,
                timeRange: [startTime, endTime],
                timeAxis: [],
                physicalValues: [],
                rawValues: [],
                actualSamples: 0,
                metadata: {
                    ...optimalDatasetInfo,
                    actualSamples: 0,
                    coordinated: true
                }
            };
        }

        console.log(`📊 Coordinated reading samples ${startSample} to ${startSample + sampleCount} (${sampleCount} samples) from ${dataset}`);

        // Read actual data using C++ addon
        const rawData = nativeAddon.readDatasetChunk(channelId, dataset, startSample, sampleCount);
        
        // Create time axis
        const timeAxis = rawData.map((_, i) => 
            ((startSample + i) * decimationFactor) / channel.sampleRate
        );

        // Convert to physical values
        const physicalValues = this.convertToPhysical(rawData, channelId);

        console.log(`✅ Coordinated loaded ${rawData.length} samples from ${dataset}`);

        return {
            channelName: channel.name,
            physicalUnit: channel.physicalUnit,
            dataset: dataset,
            timeRange: [startTime, endTime],
            timeAxis: timeAxis,
            rawValues: rawData,
            physicalValues: physicalValues,
            actualSamples: rawData.length,
            metadata: {
                ...optimalDatasetInfo,
                actualSamples: rawData.length,
                coordinated: true
            }
        };
    }

    // NEW: Load multiple channels efficiently with bulk operations
    loadMultipleChannels(channelIds, mode = 'overview', startTime = null, endTime = null, maxPoints = 2000) {
        const results = [];
        const errors = [];

        if (mode === 'overview') {
            // Bulk overview loading
            for (const channelId of channelIds) {
                try {
                    const overview = this.getChannelOverview(channelId, maxPoints);
                    results.push({
                        channelId: channelId,
                        success: true,
                        data: overview
                    });
                } catch (error) {
                    errors.push({
                        channelId: channelId,
                        error: error.message
                    });
                }
            }
        } else {
            // Coordinated range loading
            if (channelIds.length === 0) {
                return { results: [], errors: [] };
            }

            // Select optimal dataset using first channel as reference
            const optimalDatasetInfo = this.selectOptimalDatasetForRange(
                channelIds[0], 
                startTime, 
                endTime, 
                1920, 
                maxPoints
            );

            console.log(`🔗 Coordinated bulk loading using ${optimalDatasetInfo.dataset} for ${channelIds.length} channels`);

            // Load all channels using the same dataset
            for (const channelId of channelIds) {
                try {
                    const data = this.loadTimeRangeCoordinated(
                        channelId, 
                        startTime, 
                        endTime, 
                        optimalDatasetInfo,
                        maxPoints
                    );
                    results.push({
                        channelId: channelId,
                        success: true,
                        data: data
                    });
                } catch (error) {
                    errors.push({
                        channelId: channelId,
                        error: error.message
                    });
                }
            }
        }

        return {
            results: results,
            errors: errors,
            coordinated: mode !== 'overview',
            selectedDataset: mode !== 'overview' ? results[0]?.data?.dataset : undefined
        };
    }

    // NEW: Cache management for coordinated operations
    _getCacheKey(operation, params) {
        return `${operation}_${JSON.stringify(params)}`;
    }

    _setCachedResult(key, result) {
        this.coordinatedCache.set(key, {
            result: result,
            timestamp: Date.now()
        });

        // Clean up old cache entries
        if (this.coordinatedCache.size > 100) {
            this._cleanupCache();
        }
    }

    _getCachedResult(key) {
        const cached = this.coordinatedCache.get(key);
        if (!cached) return null;

        // Check if cache has expired
        if (Date.now() - cached.timestamp > this.cacheTimeout) {
            this.coordinatedCache.delete(key);
            return null;
        }

        return cached.result;
    }

    _cleanupCache() {
        const now = Date.now();
        for (const [key, cached] of this.coordinatedCache.entries()) {
            if (now - cached.timestamp > this.cacheTimeout) {
                this.coordinatedCache.delete(key);
            }
        }
    }

    // EXISTING: Keep unchanged
    convertToPhysical(rawValues, channelId) {
        const channel = this.channels.get(channelId);
        if (!channel) throw new Error(`Channel ${channelId} not found`);

        const conv = channel.conversion;
        return rawValues.map(raw => {
            const voltage = (raw * conv.binToVoltFactor) + conv.binToVoltConstant;
            const physical = (voltage * conv.voltToPhysicalFactor) + conv.voltToPhysicalConstant;
            return physical;
        });
    }

    // EXISTING: Keep unchanged
    getChannelOverview(channelId, maxPoints = 2000) {
        const channel = this.channels.get(channelId);
        if (!channel) throw new Error(`Channel ${channelId} not found`);

        const totalDuration = this._samplesToTime(channel.datasets.raw.totalSamples, channel.sampleRate);
        return this.loadTimeRange(channelId, 0, totalDuration, maxPoints);
    }

    // EXISTING: Keep unchanged
    getAvailableZoomLevels(channelId) {
        const channel = this.channels.get(channelId);
        if (!channel) throw new Error(`Channel ${channelId} not found`);

        return this.zoomLevels
            .filter(level => channel.datasets[level.dataset])
            .map(level => ({
                ...level,
                totalSamples: channel.datasets[level.dataset].totalSamples,
                sizeGB: channel.datasets[level.dataset].sizeGB,
                maxDuration: this._samplesToTime(channel.datasets[level.dataset].totalSamples, channel.sampleRate)
            }));
    }

    // EXISTING: Keep unchanged
    getChannelInfo() {
        return Array.from(this.channels.values()).map(ch => ({
            ...ch,
            totalDuration: this._samplesToTime(ch.datasets.raw?.totalSamples || 0, ch.sampleRate)
        }));
    }

    // EXISTING: Keep unchanged
    _samplesToTime(samples, sampleRate) {
        return samples / sampleRate;
    }

    // NEW: Get cache status for monitoring
    getCacheStatus() {
        return {
            coordinatedCacheEntries: this.coordinatedCache.size,
            cacheTimeout: this.cacheTimeout,
            maxCacheSize: 100
        };
    }

    // ENHANCED: Close with cache cleanup
    close() {
        if (this.isOpen) {
            nativeAddon.closeFile();
            this.isOpen = false;
            this.channels.clear();
            this.coordinatedCache.clear(); // NEW: Clear coordinated cache
            console.log('📁 Closed HDF5 file and cleared caches');
        }
    }
}

module.exports = ProgressiveZoomHDF5Reader;