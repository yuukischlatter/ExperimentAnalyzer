namespace ExperimentAnalyzer.Models.Api;

public class ApiResponse<T>
{
    public bool Success { get; set; }
    public T? Data { get; set; }
    public string? Error { get; set; }
    public ApiMetadata? Metadata { get; set; }
}