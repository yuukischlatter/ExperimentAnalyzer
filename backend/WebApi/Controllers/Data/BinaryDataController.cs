using Microsoft.AspNetCore.Mvc;
using ExperimentAnalyzer.Database.Interfaces;
using ExperimentAnalyzer.Services.Data;
using System.Text.Json;

namespace ExperimentAnalyzer.WebApi.Controllers.Data;

/// <summary>
/// Binary data controller matching JS API exactly
/// Endpoints match the old Node.js server endpoints 1:1
/// </summary>
[ApiController]
[Route("api")]
public class BinaryDataController : ControllerBase
{
    private readonly IExperimentRepository _repository;
    private readonly BinaryDataProcessor _binaryProcessor;
    private readonly ILogger<BinaryDataController> _logger;

    public BinaryDataController(
        IExperimentRepository repository, 
        BinaryDataProcessor binaryProcessor,
        ILogger<BinaryDataController> logger)
    {
        _repository = repository;
        _binaryProcessor = binaryProcessor;
        _logger = logger;
    }

    /// <summary>
    /// Get binary file metadata - MATCHES JS: /api/experiment/{folderName}/metadata
    /// </summary>
    [HttpGet("experiment/{experimentId}/metadata")]
    public async Task<IActionResult> GetMetadata(string experimentId)
    {
        try
        {
            var experiment = await _repository.GetExperimentAsync(experimentId);
            if (experiment == null)
            {
                return NotFound(new { error = "Experiment not found" });
            }

            if (!experiment.HasBinFile)
            {
                return NotFound(new { error = "No binary file available" });
            }

            var binFilePath = GetBinaryFilePath(experiment);
            if (!System.IO.File.Exists(binFilePath))
            {
                return NotFound(new { error = "Binary file not found on disk" });
            }

            var metadata = await _binaryProcessor.ReadMetadataAsync(binFilePath);

            // Return JS-compatible structure (no success wrapper)
            var response = new
            {
                channels = Enumerable.Range(0, 8).Select(i => new
                {
                    index = i,
                    label = metadata.Labels[i],
                    unit = metadata.Units[i],
                    points = (int)(metadata.BufferSize / metadata.DownsamplingFactors[i]),
                    duration = metadata.Duration
                }).ToArray(),
                totalPoints = (int)metadata.BufferSize,
                duration = metadata.Duration,
                samplingRate = metadata.SamplingRate
            };

            return Ok(response);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error reading metadata for experiment {ExperimentId}", experimentId);
            return StatusCode(500, new { error = ex.Message });
        }
    }

    /// <summary>
    /// Get data ranges for all channels - MATCHES JS: /api/experiment/{folderName}/ranges
    /// </summary>
    [HttpGet("experiment/{experimentId}/ranges")]
    public async Task<IActionResult> GetRanges(string experimentId)
    {
        try
        {
            var experiment = await _repository.GetExperimentAsync(experimentId);
            if (experiment == null)
            {
                return NotFound(new { error = "Experiment not found" });
            }

            if (!experiment.HasBinFile)
            {
                return NotFound(new { error = "No binary file available" });
            }

            var binFilePath = GetBinaryFilePath(experiment);
            var ranges = await _binaryProcessor.GetDataRangesAsync(binFilePath);

            // Return JS-compatible structure (direct ranges object)
            return Ok(ranges);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error getting ranges for experiment {ExperimentId}", experimentId);
            return StatusCode(500, new { error = ex.Message });
        }
    }

    /// <summary>
    /// Get channel data - MATCHES JS: /api/experiment/{folderName}/data/{channel}
    /// Query params match JS exactly: start, end, maxPoints (not startTime, endTime)
    /// </summary>
    [HttpGet("experiment/{experimentId}/data/{channel:int}")]
    public async Task<IActionResult> GetChannelData(
        string experimentId, 
        int channel,
        [FromQuery] double start = 0,              // Changed from startTime
        [FromQuery] double? end = null,            // Changed from endTime
        [FromQuery] int maxPoints = 2000)          // Same as JS default
    {
        try
        {
            // Validate channel
            if (channel < 0 || channel > 7)
            {
                return BadRequest(new { error = "Channel must be between 0 and 7" });
            }

            // Validate parameters
            if (maxPoints <= 0 || maxPoints > 100000)
            {
                return BadRequest(new { error = "maxPoints must be between 1 and 100000" });
            }

            if (start < 0)
            {
                return BadRequest(new { error = "start must be non-negative" });
            }

            var experiment = await _repository.GetExperimentAsync(experimentId);
            if (experiment == null)
            {
                return NotFound(new { error = "Experiment not found" });
            }

            if (!experiment.HasBinFile)
            {
                return NotFound(new { error = "No binary file available" });
            }

            var binFilePath = GetBinaryFilePath(experiment);
            
            // Use double.MaxValue if end not specified (like JS)
            var endTime = end ?? double.MaxValue;
            
            if (endTime != double.MaxValue && endTime <= start)
            {
                return BadRequest(new { error = "end must be greater than start" });
            }

            var channelData = await _binaryProcessor.ReadChannelDataAsync(
                binFilePath, channel, start, endTime, maxPoints);

            // Return JS-compatible structure (direct data, no success wrapper)
            var response = new
            {
                time = channelData.Time,
                values = channelData.Values,
                samplingRate = channelData.SamplingRate,
                meta = channelData.Meta
            };

            return Ok(response);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error reading channel {Channel} for experiment {ExperimentId}", 
                channel, experimentId);
            return StatusCode(500, new { error = ex.Message });
        }
    }

    /// <summary>
    /// Get FFT-specific data - MATCHES JS: /api/experiment/{folderName}/fft-data/{channel}
    /// </summary>
    [HttpGet("experiment/{experimentId}/fft-data/{channel:int}")]
    public async Task<IActionResult> GetFFTData(
        string experimentId,
        int channel,
        [FromQuery] double start = 0,
        [FromQuery] double? end = null,
        [FromQuery] int maxPoints = 10000)  // Higher default for FFT
    {
        try
        {
            if (channel < 0 || channel > 7)
            {
                return BadRequest(new { error = "Channel must be between 0 and 7" });
            }

            var experiment = await _repository.GetExperimentAsync(experimentId);
            if (experiment == null)
            {
                return NotFound(new { error = "Experiment not found" });
            }

            if (!experiment.HasBinFile)
            {
                return NotFound(new { error = "No binary file available" });
            }

            var binFilePath = GetBinaryFilePath(experiment);
            var endTime = end ?? double.MaxValue;
            
            // For FFT, we might want raw data instead of resampled
            var rawData = await _binaryProcessor.GetRawChannelDataAsync(binFilePath, channel);
            
            // Find time indices
            int startIdx = FindTimeIndex(rawData.Time, (float)start);
            int endIdx = endTime == double.MaxValue ? 
                rawData.Time.Length - 1 : 
                FindTimeIndex(rawData.Time, (float)endTime);
            
            // Slice the data
            int length = Math.Min(endIdx - startIdx + 1, maxPoints);
            var timeSlice = new float[length];
            var valueSlice = new float[length];
            
            Array.Copy(rawData.Time, startIdx, timeSlice, 0, length);
            Array.Copy(rawData.Values, startIdx, valueSlice, 0, length);
            
            // Get metadata for sampling rate
            var metadata = await _binaryProcessor.ReadMetadataAsync(binFilePath);
            
            var response = new
            {
                time = timeSlice,
                values = valueSlice,
                samplingRate = metadata.SamplingRate,
                channel = new
                {
                    index = channel,
                    label = rawData.Label,
                    unit = rawData.Unit
                },
                meta = new
                {
                    timeRange = new { start, end = endTime == double.MaxValue ? rawData.Time[^1] : endTime },
                    actualPoints = length,
                    requestedMaxPoints = maxPoints
                }
            };

            return Ok(response);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error getting FFT data for channel {Channel}", channel);
            return StatusCode(500, new { error = ex.Message });
        }
    }

    /// <summary>
    /// COMPATIBILITY: Also support the old endpoint format with /binary/ in path
    /// This allows frontend to work with both old and new API paths
    /// </summary>
    [HttpGet("experiments/{experimentId}/binary/metadata")]
    public async Task<IActionResult> GetMetadataCompat(string experimentId)
    {
        // Wrap response in success format for compatibility
        var result = await GetMetadata(experimentId);
        if (result is OkObjectResult okResult)
        {
            return Ok(new { success = true, data = okResult.Value });
        }
        return result;
    }

    [HttpGet("experiments/{experimentId}/binary/data/{channel:int}")]
    public async Task<IActionResult> GetChannelDataCompat(
        string experimentId,
        int channel,
        [FromQuery] double startTime = 0,    // Old parameter names
        [FromQuery] double? endTime = null,
        [FromQuery] int maxPoints = 2000)
    {
        // Call main method with renamed parameters
        var result = await GetChannelData(experimentId, channel, startTime, endTime, maxPoints);
        
        // Wrap in success format for compatibility
        if (result is OkObjectResult okResult)
        {
            // Add additional wrapper fields for old frontend
            var data = okResult.Value;
            var experiment = await _repository.GetExperimentAsync(experimentId);
            var binFilePath = GetBinaryFilePath(experiment!);
            var metadata = await _binaryProcessor.ReadMetadataAsync(binFilePath);
            
            return Ok(new 
            { 
                success = true, 
                data = new
                {
                    experimentId,
                    channel,
                    channelName = metadata.Labels[channel],
                    unit = metadata.Units[channel],
                    color = GetChannelColor(channel),
                    yAxis = GetYAxisForUnit(metadata.Units[channel]),
                    time = (data as dynamic)?.time,
                    values = (data as dynamic)?.values,
                    meta = (data as dynamic)?.meta
                }
            });
        }
        
        if (result is NotFoundObjectResult notFound)
        {
            return NotFound(new { success = false, error = (notFound.Value as dynamic)?.error });
        }
        
        if (result is BadRequestObjectResult badRequest)
        {
            return BadRequest(new { success = false, error = (badRequest.Value as dynamic)?.error });
        }
        
        return result;
    }

    #region Helper Methods

    /// <summary>
    /// Binary search for time index - matches JS exactly
    /// </summary>
    private int FindTimeIndex(float[] timeArray, float targetTime)
    {
        int left = 0;
        int right = timeArray.Length - 1;
        
        while (left <= right)
        {
            int mid = (left + right) / 2;
            if (timeArray[mid] < targetTime)
            {
                left = mid + 1;
            }
            else
            {
                right = mid - 1;
            }
        }
        
        return Math.Max(0, Math.Min(timeArray.Length - 1, left));
    }

    /// <summary>
    /// Get the file path for the binary file
    /// </summary>
    private static string GetBinaryFilePath(Models.Core.Experiment experiment)
    {
        return Path.Combine(experiment.FolderPath, $"{experiment.Id}.bin");
    }

    /// <summary>
    /// Get color for channel (consistent with frontend)
    /// </summary>
    private static string GetChannelColor(int channel)
    {
        var colors = new[]
        {
            "#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", 
            "#9467bd", "#8c564b", "#e377c2", "#7f7f7f"
        };
        return colors[channel % colors.Length];
    }

    /// <summary>
    /// Get Y-axis assignment based on unit
    /// </summary>
    private static string GetYAxisForUnit(string unit)
    {
        return unit switch
        {
            "V" => "y",      // Primary Y-axis for voltage
            "A" => "y2",     // Secondary Y-axis for current  
            "Bar" => "y3",   // Tertiary Y-axis for pressure
            _ => "y"
        };
    }

    #endregion
}