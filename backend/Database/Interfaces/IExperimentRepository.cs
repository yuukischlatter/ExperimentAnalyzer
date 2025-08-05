using ExperimentAnalyzer.Models.Core;

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
}