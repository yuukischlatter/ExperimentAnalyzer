using ExperimentAnalyzer.Models.Data;

namespace ExperimentAnalyzer.Services.Data;

/// <summary>
/// Interface for processing binary oscilloscope files from PicoScope experiments
/// Uses sequential reading approach with real-time welding calculations
/// Automatically copies network files to temp folder for optimal performance
/// Automatically decimates large datasets for browser compatibility
/// Returns 12 channels: 8 raw oscilloscope data + 4 calculated welding parameters
/// </summary>
public interface IBinFileProcessor
{
    /// <summary>
    /// Reads metadata from binary file header without loading full data
    /// Fast operation (~50ms from local temp file) for getting file information
    /// Automatically copies network files to temp folder if needed
    /// </summary>
    /// <param name="binPath">Full path to .bin file (network or local)</param>
    /// <returns>Metadata containing file info, channel configuration, and timing for 8 physical channels</returns>
    Task<BinFileMetadata> ReadMetadataAsync(string binPath);
    
    /// <summary>
    /// Loads complete binary oscilloscope data from file with welding calculations
    /// Uses sequential reading approach matching original recording logic
    /// Automatically copies network files to temp folder for optimal performance
    /// Automatically decimates data to maxPoints for browser compatibility
    /// Returns 12 channels total: 8 raw oscilloscope + 4 calculated welding parameters
    /// Operation time: ~2-5 seconds from local temp file (vs 10-30s from network)
    /// </summary>
    /// <param name="binPath">Full path to .bin file (network or local)</param>
    /// <param name="maxPoints">Maximum number of data points to return (default: 2000, max: 10000)</param>
    /// <returns>Browser-safe dataset with all channels at optimal resolution including:
    /// - Channels 0-7: Raw oscilloscope data (UL1L2, UL2L3, IL1GR1, IL3GR1, IL1GR2, IL3GR2, P_Vor, P_Rueck)
    /// - Channel 8: I_DC_GR1* (DC Current Group 1) 
    /// - Channel 9: I_DC_GR2* (DC Current Group 2)
    /// - Channel 10: U_DC* (DC Voltage)
    /// - Channel 11: F_Schlitten* (Force from pressure sensors)
    /// Data is automatically decimated if needed to stay within browser memory limits
    /// </returns>
    Task<BinOscilloscopeData> GetBinDataAsync(string binPath, int maxPoints = 2000);
    
    /// <summary>
    /// Extracts data for specific time range with browser-safe decimation
    /// Note: Currently returns full dataset with decimation - frontend can filter by TimeArray
    /// Simplified approach compared to complex time range extraction
    /// Automatically copies network files to temp folder for optimal performance
    /// Includes all 12 channels (8 raw + 4 calculated welding parameters)
    /// </summary>
    /// <param name="binPath">Full path to .bin file (network or local)</param>
    /// <param name="startTimeMs">Start time in milliseconds from experiment start</param>
    /// <param name="endTimeMs">End time in milliseconds from experiment start</param>
    /// <param name="maxPoints">Maximum number of data points to return (default: 2000, max: 10000)</param>
    /// <returns>Browser-safe resolution data with RequestedRange property set for reference</returns>
    Task<BinOscilloscopeData> GetTimeRangeDataAsync(string binPath, double startTimeMs, double endTimeMs, int maxPoints = 2000);
    
    /// <summary>
    /// Converts raw ADC value to engineering units using PicoConnect probe scaling
    /// Same conversion logic as standalone application
    /// </summary>
    /// <param name="rawValue">Raw 16-bit ADC reading</param>
    /// <param name="channelRange">PicoConnect probe range index (0-13)</param>
    /// <param name="maxADCValue">Maximum ADC value (typically 32767 for 15-bit ADC)</param>
    /// <param name="scalingFactor">Channel scaling factor (100 for V/A, 350 for Bar)</param>
    /// <returns>Value in engineering units (V, A, or Bar)</returns>
    double ConvertToEngineeringUnits(short rawValue, uint channelRange, short maxADCValue, short scalingFactor);
}