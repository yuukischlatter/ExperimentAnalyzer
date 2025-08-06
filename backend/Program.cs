using System.Data;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.FileProviders;
using ExperimentAnalyzer.Database.Interfaces;
using ExperimentAnalyzer.Database.Repositories;
using ExperimentAnalyzer.Services.Startup;
using ExperimentAnalyzer.Services.Data;
using ExperimentAnalyzer.Configuration;

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

// Binary oscilloscope services
builder.Services.AddScoped<IBinFileProcessor, BinFileProcessor>();

// Configuration
builder.Services.Configure<BinOscilloscopeSettings>(
    builder.Configuration.GetSection("BinOscilloscopeSettings"));

var app = builder.Build();

// Configure the HTTP request pipeline
app.UseSwagger();
app.UseSwaggerUI();

// Configure static file serving for frontend
var frontendPath = Path.Combine(Directory.GetCurrentDirectory(), "..", "frontend");
if (Directory.Exists(frontendPath))
{
    Console.WriteLine($"Serving frontend files from: {frontendPath}");
    app.UseStaticFiles(new StaticFileOptions
    {
        FileProvider = new PhysicalFileProvider(frontendPath),
        RequestPath = ""
    });
}
else
{
    Console.WriteLine($"Frontend directory not found at: {frontendPath}");
    Console.WriteLine("Falling back to wwwroot directory");
    app.UseStaticFiles();
}

app.UseRouting();
app.MapControllers();

// Serve index.html for any non-API routes (SPA fallback)
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