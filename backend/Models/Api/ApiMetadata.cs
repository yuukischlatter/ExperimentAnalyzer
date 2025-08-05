namespace ExperimentAnalyzer.Models.Api;

public class ApiMetadata
{
    public string RequestId { get; set; } = string.Empty;
    public DateTime Timestamp { get; set; } = DateTime.UtcNow;
    public int? ProcessingTimeMs { get; set; }
}