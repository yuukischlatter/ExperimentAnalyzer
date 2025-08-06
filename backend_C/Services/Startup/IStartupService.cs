using ExperimentAnalyzer.Models.Api;

namespace ExperimentAnalyzer.Services.Startup;

public interface IStartupService
{
    Task<ServiceResult> ExecuteAsync(bool forceRefresh = false);
    string ServiceName { get; }
}