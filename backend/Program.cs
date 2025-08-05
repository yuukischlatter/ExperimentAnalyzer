using System.Data;
using Microsoft.Data.Sqlite;
using ExperimentAnalyzer.Database.Interfaces;
using ExperimentAnalyzer.Database.Repositories;
using ExperimentAnalyzer.Services.Startup;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container
builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

// Database connection
builder.Services.AddSingleton<IDbConnection>(provider =>
{
    var connectionString = builder.Configuration.GetConnectionString("DefaultConnection")
        ?? throw new InvalidOperationException("Database connection string not found");
    return new SqliteConnection(connectionString);
});

// Repository
builder.Services.AddScoped<IExperimentRepository, ExperimentRepository>();

// Startup services
builder.Services.AddScoped<DirectoryScanner>();
builder.Services.AddScoped<JournalParser>();
builder.Services.AddScoped<StartupDataService>();

var app = builder.Build();

// Configure the HTTP request pipeline
app.UseSwagger();
app.UseSwaggerUI();

app.UseStaticFiles();
app.UseRouting();
app.MapControllers();

// Serve frontend files
app.MapFallbackToFile("index.html");

// Check for command line arguments
var forceRefresh = args.Contains("--force-refresh");

// Initialize database and run startup services
using (var scope = app.Services.CreateScope())
{
    try
    {
        // Initialize database schema
        var repository = scope.ServiceProvider.GetRequiredService<IExperimentRepository>();
        await repository.InitializeDatabaseAsync();
        Console.WriteLine("Database initialized successfully");
        
        // Run startup data services
        var startupService = scope.ServiceProvider.GetRequiredService<StartupDataService>();
        var success = await startupService.InitializeAllDataAsync(forceRefresh);
        
        if (success)
        {
            var count = await repository.GetExperimentCountAsync();
            Console.WriteLine($"Data initialization completed successfully. Total experiments: {count}");
        }
        else
        {
            Console.WriteLine("Data initialization completed with errors");
        }
    }
    catch (Exception ex)
    {
        Console.WriteLine($"Startup failed: {ex.Message}");
        Console.WriteLine("Application will continue but data may not be available");
    }
}

Console.WriteLine("Starting web server...");
await app.RunAsync();