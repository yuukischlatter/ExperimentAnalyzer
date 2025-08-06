using Microsoft.AspNetCore.Mvc;
using ExperimentAnalyzer.Database.Interfaces;
using ExperimentAnalyzer.Models.Api;
using ExperimentAnalyzer.Models.Data;
using ExperimentAnalyzer.Services.Data;

namespace ExperimentAnalyzer.WebApi.Controllers.Data;

/// <summary>
/// REST API controller for binary oscilloscope data from PicoScope experiments
/// Provides endpoints for metadata, overview, and full resolution data
/// Returns 12 channels: 8 raw oscilloscope + 4 calculated welding parameters
/// Uses sequential reading approach with real-time welding calculations
/// </summary>
[ApiController]
[Route("api/experiments/{experimentId}/bin-oscilloscope")]
public class BinOscilloscopeController : ControllerBase
{
    private readonly IBinFileProcessor _binFileProcessor;
    private readonly IExperimentRepository _repository;
    private readonly ILogger<BinOscilloscopeController> _logger;
    
    public BinOscilloscopeController(
        IBinFileProcessor binFileProcessor,
        IExperimentRepository repository,
        ILogger<BinOscilloscopeController> logger)
    {
        _binFileProcessor = binFileProcessor;
        _repository = repository;
        _logger = logger;
    }
    
    /// <summary>
    /// Get binary oscilloscope metadata (fast ~100ms)
    /// Returns header information without loading full data
    /// Describes 8 physical channels from file
    /// </summary>
    [HttpGet("metadata")]
    public async Task<ActionResult<ApiResponse<BinFileMetadata>>> GetMetadata(string experimentId)
    {
        try
        {
            _logger.LogDebug("Getting metadata for experiment: {ExperimentId}", experimentId);
            
            var binPath = await GetBinFilePathAsync(experimentId);
            if (binPath == null)
            {
                return NotFound(CreateErrorResponse<BinFileMetadata>("Binary file not found for experiment"));
            }
            
            var metadata = await _binFileProcessor.ReadMetadataAsync(binPath);
            
            _logger.LogDebug("Metadata retrieved successfully. Duration: {Duration}ms, Physical channels: {Channels}", 
                metadata.TotalDurationMs, metadata.ChannelCount);
            
            return Ok(new ApiResponse<BinFileMetadata>
            {
                Success = true,
                Data = metadata,
                Metadata = CreateApiMetadata()
            });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to get metadata for experiment: {ExperimentId}", experimentId);
            return StatusCode(500, CreateErrorResponse<BinFileMetadata>(ex.Message));
        }
    }
    
    /// <summary>
    /// Get cached overview data (fast ~100ms if cached, ~10s if not cached)
    /// Returns ~5000 decimated points for quick visualization
    /// Includes all 12 channels: 8 raw + 4 calculated welding parameters
    /// </summary>
    [HttpGet("overview")]
    public async Task<ActionResult<ApiResponse<BinOscilloscopeData>>> GetOverview(string experimentId)
    {
        try
        {
            _logger.LogDebug("Getting overview data for experiment: {ExperimentId}", experimentId);
            
            // Check cache first
            var cachedOverview = await _repository.GetCachedOverviewAsync(experimentId);
            if (cachedOverview != null)
            {
                _logger.LogDebug("Returning cached overview for experiment: {ExperimentId} with {Channels} channels", 
                    experimentId, cachedOverview.Channels.Count);
                return Ok(new ApiResponse<BinOscilloscopeData>
                {
                    Success = true,
                    Data = cachedOverview,
                    Metadata = CreateApiMetadata()
                });
            }
            
            // Generate overview if not cached
            var binPath = await GetBinFilePathAsync(experimentId);
            if (binPath == null)
            {
                return NotFound(CreateErrorResponse<BinOscilloscopeData>("Binary file not found for experiment"));
            }
            
            _logger.LogInformation("Generating sequential overview data for experiment: {ExperimentId}", experimentId);
            var overviewData = await _binFileProcessor.GetOverviewDataAsync(binPath);
            
            _logger.LogInformation("Overview data generated successfully. {DataPoints} points, {Channels} total channels (including welding calculations)", 
                overviewData.TotalDataPoints, overviewData.Channels.Count);
            
            // Cache the generated overview
            await _repository.SaveOverviewCacheAsync(experimentId, overviewData);
            
            return Ok(new ApiResponse<BinOscilloscopeData>
            {
                Success = true,
                Data = overviewData,
                Metadata = CreateApiMetadata()
            });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to get overview data for experiment: {ExperimentId}", experimentId);
            return StatusCode(500, CreateErrorResponse<BinOscilloscopeData>(ex.Message));
        }
    }
    
    /// <summary>
    /// Get full resolution binary oscilloscope data with welding calculations
    /// Uses sequential reading approach (~10-30 seconds for 2-3GB files)
    /// Returns 12 channels: 8 raw oscilloscope + 4 calculated welding parameters
    /// Time range parameters are maintained for API compatibility but simplified implementation
    /// </summary>
    [HttpGet]
    public async Task<ActionResult<ApiResponse<BinOscilloscopeData>>> GetFullData(
        string experimentId,
        [FromQuery] double? startTimeMs = null,
        [FromQuery] double? endTimeMs = null)
    {
        try
        {
            if (startTimeMs.HasValue && endTimeMs.HasValue)
            {
                _logger.LogInformation("Getting sequential binary data for experiment: {ExperimentId}, requested range: {Start}-{End}ms", 
                    experimentId, startTimeMs, endTimeMs);
            }
            else
            {
                _logger.LogInformation("Getting full sequential binary data for experiment: {ExperimentId}", experimentId);
            }
            
            var binPath = await GetBinFilePathAsync(experimentId);
            if (binPath == null)
            {
                return NotFound(CreateErrorResponse<BinOscilloscopeData>("Binary file not found for experiment"));
            }
            
            BinOscilloscopeData data;
            
            // Simplified approach: load full data, let frontend filter by TimeArray if needed
            if (startTimeMs.HasValue && endTimeMs.HasValue)
            {
                data = await _binFileProcessor.GetTimeRangeDataAsync(binPath, startTimeMs.Value, endTimeMs.Value);
                _logger.LogInformation("Sequential data loaded with requested range reference. {DataPoints} points, {Channels} channels", 
                    data.TotalDataPoints, data.Channels.Count);
            }
            else
            {
                data = await _binFileProcessor.GetBinDataAsync(binPath);
                _logger.LogInformation("Full sequential data loaded successfully. {DataPoints} points, {Channels} channels including welding calculations", 
                    data.TotalDataPoints, data.Channels.Count);
            }
            
            // Log welding channel availability
            var weldingChannels = data.Channels.Where(kvp => kvp.Value.IsCalculatedWeldingChannel).Count();
            _logger.LogDebug("Welding calculations included: {WeldingChannels} calculated channels", weldingChannels);
            
            return Ok(new ApiResponse<BinOscilloscopeData>
            {
                Success = true,
                Data = data,
                Metadata = CreateApiMetadata()
            });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to get sequential data for experiment: {ExperimentId}", experimentId);
            return StatusCode(500, CreateErrorResponse<BinOscilloscopeData>(ex.Message));
        }
    }
    
    /// <summary>
    /// Get specific time range data with full resolution
    /// Simplified implementation: returns full data with RequestedRange property set
    /// Frontend can filter using TimeArray for actual time range extraction
    /// Includes all 12 channels: 8 raw + 4 calculated welding parameters
    /// </summary>
    [HttpGet("range")]
    public async Task<ActionResult<ApiResponse<BinOscilloscopeData>>> GetTimeRange(
        string experimentId,
        [FromQuery] double startTimeMs,
        [FromQuery] double endTimeMs)
    {
        try
        {
            if (startTimeMs < 0 || endTimeMs <= startTimeMs)
            {
                return BadRequest(CreateErrorResponse<BinOscilloscopeData>("Invalid time range parameters"));
            }
            
            _logger.LogDebug("Getting sequential time range data for experiment: {ExperimentId}, range: {Start}-{End}ms", 
                experimentId, startTimeMs, endTimeMs);
            
            var binPath = await GetBinFilePathAsync(experimentId);
            if (binPath == null)
            {
                return NotFound(CreateErrorResponse<BinOscilloscopeData>("Binary file not found for experiment"));
            }
            
            var data = await _binFileProcessor.GetTimeRangeDataAsync(binPath, startTimeMs, endTimeMs);
            
            _logger.LogInformation("Sequential time range data loaded. {DataPoints} points, {Channels} channels, requested range: {Start}-{End}ms", 
                data.TotalDataPoints, data.Channels.Count, startTimeMs, endTimeMs);
            
            return Ok(new ApiResponse<BinOscilloscopeData>
            {
                Success = true,
                Data = data,
                Metadata = CreateApiMetadata()
            });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to get sequential time range data for experiment: {ExperimentId}", experimentId);
            return StatusCode(500, CreateErrorResponse<BinOscilloscopeData>(ex.Message));
        }
    }
    
    /// <summary>
    /// Resolves binary file path for experiment
    /// </summary>
    private async Task<string?> GetBinFilePathAsync(string experimentId)
    {
        var experiment = await _repository.GetExperimentAsync(experimentId);
        if (experiment == null || !experiment.HasBinFile)
        {
            return null;
        }
        
        var binPath = Path.Combine(experiment.FolderPath, $"{experimentId}.bin");
        return System.IO.File.Exists(binPath) ? binPath : null;
    }
    
    /// <summary>
    /// Creates standardized API metadata
    /// </summary>
    private ApiMetadata CreateApiMetadata()
    {
        return new ApiMetadata
        {
            RequestId = HttpContext.TraceIdentifier,
            Timestamp = DateTime.UtcNow
        };
    }
    
    /// <summary>
    /// Creates standardized error response
    /// </summary>
    private ApiResponse<T> CreateErrorResponse<T>(string errorMessage)
    {
        return new ApiResponse<T>
        {
            Success = false,
            Error = errorMessage,
            Metadata = CreateApiMetadata()
        };
    }
}