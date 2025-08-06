namespace ExperimentAnalyzer.Models.Api;

public class ServiceResult
{
    public bool Success { get; set; }
    public string Message { get; set; } = string.Empty;
    public int ProcessedCount { get; set; }
    public int SkippedCount { get; set; }
    public TimeSpan Duration { get; set; }
    public List<string> Errors { get; set; } = new List<string>();
}