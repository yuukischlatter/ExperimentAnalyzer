# Complete Experiments API Endpoints Reference

## Base Experiments Routes

### Core Experiment Management
- `GET /api/experiments/count` - Get total experiment count
- `GET /api/experiments/status` - Get service status and statistics
- `GET /api/experiments/health` - Quick health check
- `POST /api/experiments/rescan` - Rescan experiments (directory scanner + journal parser)
- `POST /api/experiments/scan-only` - Run directory scanner only
- `POST /api/experiments/parse-only` - Run journal parser only
- `GET /api/experiments` - Get experiments with optional filtering and sorting
- `GET /api/experiments/:experimentId` - Get single experiment with metadata

## Binary Data Routes (Oscilloscope Data)

### Binary File Operations
- `GET /api/experiments/:experimentId/bin-metadata` - Get binary file metadata and channel information
- `GET /api/experiments/:experimentId/bin-data/:channelId` - Get single channel data with resampling
- `POST /api/experiments/:experimentId/bin-data/bulk` - Get multiple channels data efficiently
- `GET /api/experiments/:experimentId/bin-stats/:channelId` - Get channel statistics
- `GET /api/experiments/:experimentId/bin-channels` - Get available channels information
- `DELETE /api/experiments/:experimentId/bin-cache` - Clear cached binary data for experiment
- `GET /api/experiments/:experimentId/bin-file-info` - Get binary file information without parsing

### Binary Service Management
- `GET /api/experiments/bin-service/status` - Get binary parser service status
- `POST /api/experiments/bin-service/clear-all-cache` - Clear all cached binary data

## Temperature CSV Data Routes

### Temperature Data Operations
- `GET /api/experiments/:experimentId/temp-metadata` - Get temperature CSV file metadata
- `GET /api/experiments/:experimentId/temp-data/:channelId` - Get single temperature channel data
- `POST /api/experiments/:experimentId/temp-data/bulk` - Get multiple temperature channels data
- `GET /api/experiments/:experimentId/temp-stats/:channelId` - Get temperature channel statistics
- `GET /api/experiments/:experimentId/temp-channels` - Get available temperature channels
- `DELETE /api/experiments/:experimentId/temp-cache` - Clear cached temperature data
- `GET /api/experiments/:experimentId/temp-file-info` - Get temperature file information

### Temperature Service Management
- `GET /api/experiments/temp-service/status` - Get temperature CSV service status
- `POST /api/experiments/temp-service/clear-all-cache` - Clear all cached temperature data

## Position CSV Data Routes

### Position Data Operations
- `GET /api/experiments/:experimentId/pos-metadata` - Get position CSV file metadata
- `GET /api/experiments/:experimentId/pos-data/:channelId` - Get single position channel data (pos_x only)
- `POST /api/experiments/:experimentId/pos-data/bulk` - Get multiple position channels data
- `GET /api/experiments/:experimentId/pos-stats/:channelId` - Get position channel statistics
- `GET /api/experiments/:experimentId/pos-channels` - Get available position channels
- `DELETE /api/experiments/:experimentId/pos-cache` - Clear cached position data
- `GET /api/experiments/:experimentId/pos-file-info` - Get position file information

### Position Service Management
- `GET /api/experiments/pos-service/status` - Get position CSV service status
- `POST /api/experiments/pos-service/clear-all-cache` - Clear all cached position data

## Acceleration CSV Data Routes

### Acceleration Data Operations
- `GET /api/experiments/:experimentId/acc-metadata` - Get acceleration CSV file metadata
- `GET /api/experiments/:experimentId/acc-data/:channelId` - Get acceleration channel data (acc_x, acc_y, acc_z, acc_magnitude)
- `POST /api/experiments/:experimentId/acc-data/bulk` - Get multiple acceleration channels data
- `GET /api/experiments/:experimentId/acc-stats/:channelId` - Get acceleration channel statistics
- `GET /api/experiments/:experimentId/acc-channels` - Get available acceleration channels
- `DELETE /api/experiments/:experimentId/acc-cache` - Clear cached acceleration data
- `GET /api/experiments/:experimentId/acc-file-info` - Get acceleration file information

### Acceleration Service Management
- `GET /api/experiments/acc-service/status` - Get acceleration CSV service status
- `POST /api/experiments/acc-service/clear-all-cache` - Clear all cached acceleration data

## Tensile CSV Data Routes

### Tensile Data Operations
- `GET /api/experiments/:experimentId/tensile-metadata` - Get tensile CSV file metadata
- `GET /api/experiments/:experimentId/tensile-data/:channelId` - Get tensile channel data (force_kN, displacement_mm, force_vs_displacement)
- `POST /api/experiments/:experimentId/tensile-data/bulk` - Get multiple tensile channels data
- `GET /api/experiments/:experimentId/tensile-stats/:channelId` - Get tensile channel statistics
- `GET /api/experiments/:experimentId/tensile-channels` - Get available tensile channels
- `DELETE /api/experiments/:experimentId/tensile-cache` - Clear cached tensile data
- `GET /api/experiments/:experimentId/tensile-file-info` - Get tensile file information

### Tensile Service Management
- `GET /api/experiments/tensile-service/status` - Get tensile CSV service status
- `POST /api/experiments/tensile-service/clear-all-cache` - Clear all cached tensile data

## Photo/Image Data Routes

### Photo Operations
- `GET /api/experiments/:experimentId/photos` - Get all photos metadata for an experiment
- `GET /api/experiments/:experimentId/photos/metadata` - Get photos metadata only (lightweight)
- `GET /api/experiments/:experimentId/photos/:filename` - Serve raw image file
- `GET /api/experiments/:experimentId/photos-info` - Get photo information without processing
- `DELETE /api/experiments/:experimentId/photos-cache` - Clear cached photo data

### Photo Service Management
- `GET /api/experiments/photos-service/status` - Get photo service status
- `POST /api/experiments/photos-service/clear-all-cache` - Clear all cached photo data

## Crown Measurement Data Routes

### Crown Data Operations
- `GET /api/experiments/:experimentId/crown-metadata` - Get crown measurement metadata
- `GET /api/experiments/:experimentId/crown-data/:channelId` - Get crown channel data (crown_warm_side, crown_cold_side, crown_top_view, crown_calculated)
- `POST /api/experiments/:experimentId/crown-data/bulk` - Get multiple crown channels data
- `GET /api/experiments/:experimentId/crown-stats/:channelId` - Get crown channel statistics
- `GET /api/experiments/:experimentId/crown-channels` - Get available crown channels
- `DELETE /api/experiments/:experimentId/crown-cache` - Clear cached crown data
- `GET /api/experiments/:experimentId/crown-file-info` - Get crown file information

### Crown Service Management
- `GET /api/experiments/crown-service/status` - Get crown service status
- `POST /api/experiments/crown-service/clear-all-cache` - Clear all cached crown data

## TPC5 Data Routes

### TPC5 Data Operations
- `GET /api/experiments/:experimentId/tpc5-metadata` - Get TPC5 file metadata
- `GET /api/experiments/:experimentId/tpc5-data/:channelId` - Get TPC5 channel data
- `POST /api/experiments/:experimentId/tpc5-data/bulk` - Get multiple TPC5 channels data
- `GET /api/experiments/:experimentId/tpc5-stats/:channelId` - Get TPC5 channel statistics
- `GET /api/experiments/:experimentId/tpc5-channels` - Get available TPC5 channels
- `DELETE /api/experiments/:experimentId/tpc5-cache` - Clear cached TPC5 data
- `GET /api/experiments/:experimentId/tpc5-file-info` - Get TPC5 file information

### TPC5 Service Management
- `GET /api/experiments/tpc5-service/status` - Get TPC5 parser service status
- `POST /api/experiments/tpc5-service/clear-all-cache` - Clear all cached TPC5 data

## Summary and Notes Routes

### Summary Operations
- `GET /api/experiments/:experimentId/summary` - Get computed experiment summary with key metrics
- `GET /api/experiments/:experimentId/summary/refresh` - Force refresh experiment summary
- `POST /api/experiments/summaries/bulk` - Get summaries for multiple experiments
- `POST /api/experiments/summaries/refresh-all` - Refresh all experiment summaries
- `GET /api/experiments/summaries/status` - Get summary service status
- `POST /api/experiments/summaries/clear-cache` - Clear all summary cache

### Notes Operations
- `GET /api/experiments/:experimentId/notes` - Get user notes for experiment
- `PUT /api/experiments/:experimentId/notes` - Save or update user notes for experiment
- `DELETE /api/experiments/:experimentId/notes` - Delete user notes for experiment

### Combined Data
- `GET /api/experiments/:experimentId/full` - Get complete experiment data (experiment + metadata + notes + summary)

## Common Query Parameters

### Data Retrieval Parameters
- `start` - Start time for time-series data (default: 0)
- `end` - End time for time-series data (default: null = all data)
- `maxPoints` - Maximum number of data points to return (default: 2000, max: 50000)
- `forceRefresh` - Force cache refresh (default: false)
- `refresh` - Refresh summary cache (default: false)

### Experiment Listing Parameters
- `sortBy` - Sort field (default: 'date')
- `sortDirection` - Sort direction: 'asc' or 'desc' (default: 'desc')
- `filterBy` - Filter field (default: null)
- `filterValue` - Filter value (default: null)

## Supported Channel Types by Data Source

### Binary Data Channels
- **Raw channels**: `channel_0` to `channel_7` (8 channels)
- **Calculated channels**: `calc_0` to `calc_6` (7 channels)

### Temperature Data Channels
- **Welding temperature**: `temp_welding`
- **Sensor channels**: `temp_channel_1` to `temp_channel_8`

### Position Data Channels
- **Position**: `pos_x` (X-axis position in mm)

### Acceleration Data Channels
- **Axes**: `acc_x`, `acc_y`, `acc_z`
- **Calculated**: `acc_magnitude` (sqrt(x² + y² + z²))

### Tensile Data Channels
- **Time series**: `force_kN`, `displacement_mm`
- **XY relationship**: `force_vs_displacement`

### Crown Data Channels
- **Temperature states**: `crown_warm_side`, `crown_cold_side`
- **Views**: `crown_top_view`
- **Calculated**: `crown_calculated`

### TPC5 Data Channels
- **Raw channels**: `channel_0` to `channel_5` (6 channels)
- **Calculated channels**: `calc_0` to `calc_6` (7 channels, calc_6 unavailable)

## Response Format
All API responses follow a consistent format with success/error status and appropriate HTTP status codes. Data endpoints support resampling and caching for optimal performance.