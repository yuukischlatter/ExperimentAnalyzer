using ExperimentAnalyzer.Models.Core;
using ExperimentAnalyzer.Models.Data;

namespace ExperimentAnalyzer.Database.Interfaces;

public interface IExperimentRepository
{
    // Existence checks (for incremental updates)
    Task<bool> ExperimentExistsAsync(string experimentId);
    Task<bool> MetadataExistsAsync(string experimentId);
    
    // Single experiment operations
    Task<Experiment?> GetExperimentAsync(string experimentId);
    Task<ExperimentWithMetadata?> GetExperimentWithMetadataAsync(string experimentId);
    Task UpsertExperimentAsync(Experiment experiment);
    Task UpsertMetadataAsync(ExperimentMetadata metadata);
    
    // Bulk operations for browser/API
    Task<List<Experiment>> GetExperimentsWithJournalsAsync();
    Task<List<ExperimentWithMetadata>> GetAllExperimentsWithMetadataAsync();
    Task<List<ExperimentWithMetadata>> GetFilteredExperimentsAsync(
        string? filterBy = null, 
        string? filterValue = null,
        string sortBy = "date",
        string sortDirection = "desc");
    
    // Database management
    Task InitializeDatabaseAsync();
    Task<int> GetExperimentCountAsync();
    
    // Binary oscilloscope cache operations
    /// Retrieves cached overview data for binary oscilloscope
    /// Returns null if no cache exists for this experiment
    Task<BinOscilloscopeData?> GetCachedOverviewAsync(string experimentId);
    
    /// Saves overview data to cache for instant future access
    /// Serializes BinOscilloscopeData to JSON and stores in database
    Task SaveOverviewCacheAsync(string experimentId, BinOscilloscopeData overviewData);
    
    /// Removes cached overview data for specific experiment
    /// Useful for cache invalidation if needed
    Task ClearCachedOverviewAsync(string experimentId);
    
    /// Gets count of experiments with cached overview data
    /// Useful for monitoring cache usage
    Task<int> GetCachedOverviewCountAsync();
}