using ExperimentAnalyzer.Models.Data;

namespace ExperimentAnalyzer.Services.Data;

/// <summary>
/// Interface for processing binary oscilloscope files from PicoScope experiments
/// </summary>
public interface IBinFileProcessor
{
    /// <summary>
    /// Reads metadata from binary file header without loading full data
    /// Fast operation (~100ms) for getting file information
    /// </summary>
    /// <param name="binPath">Full path to .bin file</param>
    /// <returns>Metadata containing file info, channel configuration, and timing</returns>
    Task<BinFileMetadata> ReadMetadataAsync(string binPath);
    
    /// <summary>
    /// Loads complete binary oscilloscope data from file
    /// Slow operation (~10-30 seconds) for 2-3GB files
    /// </summary>
    /// <param name="binPath">Full path to .bin file</param>
    /// <returns>Complete dataset with all channels and full resolution</returns>
    Task<BinOscilloscopeData> GetBinDataAsync(string binPath);
    
    /// <summary>
    /// Generates decimated overview data for quick visualization
    /// Creates ~5000 data points by intelligent decimation
    /// </summary>
    /// <param name="binPath">Full path to .bin file</param>
    /// <param name="maxPoints">Maximum number of points to return (default: 5000)</param>
    /// <returns>Decimated dataset suitable for overview plotting</returns>
    Task<BinOscilloscopeData> GetOverviewDataAsync(string binPath, int maxPoints = 5000);
    
    /// <summary>
    /// Extracts data for specific time range with full resolution
    /// Efficient for zoomed-in analysis of specific time windows
    /// </summary>
    /// <param name="binPath">Full path to .bin file</param>
    /// <param name="startTimeMs">Start time in milliseconds from experiment start</param>
    /// <param name="endTimeMs">End time in milliseconds from experiment start</param>
    /// <returns>Full resolution data for the specified time range</returns>
    Task<BinOscilloscopeData> GetTimeRangeDataAsync(string binPath, double startTimeMs, double endTimeMs);
    
    /// <summary>
    /// Converts raw ADC value to engineering units using PicoConnect probe scaling
    /// </summary>
    /// <param name="rawValue">Raw 16-bit ADC reading</param>
    /// <param name="channelRange">PicoConnect probe range index</param>
    /// <param name="maxADCValue">Maximum ADC value (typically 32767)</param>
    /// <param name="scalingFactor">Channel scaling factor (100 for V/A, 350 for Bar)</param>
    /// <returns>Value in engineering units (V, A, or Bar)</returns>
    double ConvertToEngineeringUnits(short rawValue, uint channelRange, short maxADCValue, short scalingFactor);
    
    /// <summary>
    /// Calculates intelligent decimation ratio based on desired output points
    /// Used internally for overview generation and time range optimization
    /// </summary>
    /// <param name="totalSamples">Total samples in source data</param>
    /// <param name="maxOutputPoints">Maximum desired output points</param>
    /// <returns>Decimation ratio to achieve target point count</returns>
    int CalculateDecimationRatio(uint totalSamples, int maxOutputPoints);
}