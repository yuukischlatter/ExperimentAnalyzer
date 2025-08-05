namespace ExperimentAnalyzer.Models.Core;

public class ExperimentWithMetadata
{
    public Experiment Experiment { get; set; } = new Experiment();
    public ExperimentMetadata? Metadata { get; set; }
}